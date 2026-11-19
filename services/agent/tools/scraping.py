# tools/scraping.py
"""
Ethical web scraping infrastructure for academic research.
Provides rate-limited, robots.txt-respecting scraping utilities.
"""

import requests
import time
import random
import logging
from typing import Dict, Optional, List
from urllib.robotparser import RobotFileParser
from urllib.parse import urljoin, urlparse
from fake_useragent import UserAgent
import re

logger = logging.getLogger(__name__)

class EthicalScraper:
    """Base class for ethical web scraping with rate limiting"""
    
    def __init__(self, min_delay: float = 2.0, max_delay: float = 5.0):
        self.rate_limiter = {}
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.user_agent = UserAgent()
        self.respect_robots_txt = True
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': self.user_agent.random
        })
    
    def check_robots_txt(self, url: str) -> bool:
        """Check if scraping is allowed by robots.txt"""
        if not self.respect_robots_txt:
            return True
        
        try:
            parsed_url = urlparse(url)
            robots_url = f"{parsed_url.scheme}://{parsed_url.netloc}/robots.txt"
            
            rp = RobotFileParser()
            rp.set_url(robots_url)
            rp.read()
            
            return rp.can_fetch(self.session.headers['User-Agent'], url)
        except Exception as e:
            logger.warning(f"Could not check robots.txt for {url}: {e}")
            return True  # Default to allowing if we can't check
    
    def rate_limited_request(self, url: str, **kwargs) -> requests.Response:
        """Make rate-limited request with proper delays"""
        domain = urlparse(url).netloc
        
        # Check robots.txt
        if not self.check_robots_txt(url):
            raise Exception(f"Scraping not allowed by robots.txt for {url}")
        
        # Rate limiting per domain
        if domain in self.rate_limiter:
            time_since_last = time.time() - self.rate_limiter[domain]
            if time_since_last < self.min_delay:
                sleep_time = self.min_delay - time_since_last + random.uniform(0, 1)
                logger.info(f"Rate limiting: sleeping {sleep_time:.2f}s for {domain}")
                time.sleep(sleep_time)
        
        # Make request
        try:
            response = self.session.get(url, timeout=15, **kwargs)
            self.rate_limiter[domain] = time.time()
            
            # Add random delay after request
            delay = random.uniform(self.min_delay, self.max_delay)
            time.sleep(delay)
            
            return response
        except Exception as e:
            logger.error(f"Request failed for {url}: {e}")
            raise

class GoogleScholarScraper(EthicalScraper):
    """Scrape Google Scholar with proper rate limiting"""
    
    def __init__(self):
        super().__init__(min_delay=3.0, max_delay=6.0)  # More conservative for Google
        self.base_url = "https://scholar.google.com/scholar"
    
    def search(self, query: str, max_results: int = 10) -> List[Dict]:
        """Search Google Scholar and return structured results"""
        try:
            # Use scholarly library if available, otherwise fall back to basic scraping
            try:
                from scholarly import scholarly
                search_query = scholarly.search_pubs(query)
                results = []
                
                for i, pub in enumerate(search_query):
                    if i >= max_results:
                        break
                    
                    try:
                        # Get full publication details
                        pub_filled = scholarly.fill(pub)
                        
                        result = {
                            'title': pub_filled.get('bib', {}).get('title', 'No title'),
                            'authors': pub_filled.get('bib', {}).get('author', ['Unknown']),
                            'year': pub_filled.get('bib', {}).get('pub_year', 'Unknown'),
                            'venue': pub_filled.get('bib', {}).get('venue', 'Unknown'),
                            'abstract': pub_filled.get('bib', {}).get('abstract', 'No abstract')[:300] + "...",
                            'url': pub_filled.get('pub_url', 'N/A'),
                            'citations': pub_filled.get('num_citations', 0)
                        }
                        results.append(result)
                        
                        # Rate limiting between requests
                        time.sleep(random.uniform(2, 4))
                        
                    except Exception as e:
                        logger.warning(f"Error processing Google Scholar result: {e}")
                        continue
                
                return results
                
            except ImportError:
                logger.warning("scholarly library not available, using basic scraping")
                return self._basic_scrape(query, max_results)
                
        except Exception as e:
            logger.error(f"Google Scholar search failed: {e}")
            return []

    def _basic_scrape(self, query: str, max_results: int) -> List[Dict]:
        """Basic scraping fallback when scholarly library is not available"""
        try:
            params = {
                'q': query,
                'hl': 'en',
                'as_sdt': '0,5'
            }
            
            response = self.rate_limited_request(self.base_url, params=params)
            
            if response.status_code != 200:
                return []
            
            # Basic HTML parsing (simplified)
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.content, 'html.parser')
            
            results = []
            for gs_ri in soup.find_all('div', class_='gs_ri')[:max_results]:
                try:
                    title_elem = gs_ri.find('h3', class_='gs_rt')
                    title = title_elem.get_text() if title_elem else 'No title'
                    
                    authors_elem = gs_ri.find('div', class_='gs_a')
                    authors = authors_elem.get_text() if authors_elem else 'Unknown authors'
                    
                    snippet_elem = gs_ri.find('div', class_='gs_rs')
                    abstract = snippet_elem.get_text()[:300] + "..." if snippet_elem else 'No abstract'
                    
                    result = {
                        'title': title,
                        'authors': [authors],
                        'year': 'Unknown',
                        'venue': 'Unknown',
                        'abstract': abstract,
                        'url': 'N/A',
                        'citations': 0
                    }
                    results.append(result)
                    
                except Exception as e:
                    logger.warning(f"Error parsing Google Scholar result: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"Basic Google Scholar scraping failed: {e}")
            return []

class SpringerNatureScraper(EthicalScraper):
    """Scrape Springer Nature search results"""
    
    def __init__(self):
        super().__init__(min_delay=2.0, max_delay=4.0)
        self.base_url = "https://link.springer.com/search"
    
    def search(self, query: str, max_results: int = 10) -> List[Dict]:
        """Search Springer Nature"""
        try:
            params = {
                'query': query,
                'search-within': 'Journal',
                'facet-content-type': 'Article',
                'showAll': 'true'
            }
            
            response = self.rate_limited_request(self.base_url, params=params)
            
            if response.status_code != 200:
                return []
            
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.content, 'html.parser')
            
            results = []
            for article in soup.find_all('li', class_='item')[:max_results]:
                try:
                    title_elem = article.find('h3', class_='title')
                    title = title_elem.get_text().strip() if title_elem else 'No title'
                    
                    authors_elem = article.find('span', class_='authors')
                    authors = authors_elem.get_text().strip() if authors_elem else 'Unknown authors'
                    
                    journal_elem = article.find('span', class_='journal')
                    journal = journal_elem.get_text().strip() if journal_elem else 'Unknown journal'
                    
                    year_elem = article.find('span', class_='year')
                    year = year_elem.get_text().strip() if year_elem else 'Unknown'
                    
                    link_elem = article.find('a', class_='title')
                    url = urljoin(self.base_url, link_elem['href']) if link_elem else 'N/A'
                    
                    result = {
                        'title': title,
                        'authors': [authors],
                        'year': year,
                        'venue': journal,
                        'abstract': 'No abstract available',
                        'url': url,
                        'citations': 0
                    }
                    results.append(result)
                    
                except Exception as e:
                    logger.warning(f"Error parsing Springer result: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"Springer Nature search failed: {e}")
            return []

class ElsevierScraper(EthicalScraper):
    """Scrape Elsevier/ScienceDirect search results"""
    
    def __init__(self):
        super().__init__(min_delay=2.5, max_delay=5.0)
        self.base_url = "https://www.sciencedirect.com/search"
    
    def search(self, query: str, max_results: int = 10) -> List[Dict]:
        """Search ScienceDirect"""
        try:
            params = {
                'qs': query,
                'show': '100'
            }
            
            response = self.rate_limited_request(self.base_url, params=params)
            
            if response.status_code != 200:
                return []
            
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.content, 'html.parser')
            
            results = []
            for article in soup.find_all('div', class_='result-item')[:max_results]:
                try:
                    title_elem = article.find('h3', class_='result-item-title')
                    title = title_elem.get_text().strip() if title_elem else 'No title'
                    
                    authors_elem = article.find('span', class_='authors')
                    authors = authors_elem.get_text().strip() if authors_elem else 'Unknown authors'
                    
                    journal_elem = article.find('span', class_='publication-title')
                    journal = journal_elem.get_text().strip() if journal_elem else 'Unknown journal'
                    
                    year_elem = article.find('span', class_='publication-year')
                    year = year_elem.get_text().strip() if year_elem else 'Unknown'
                    
                    link_elem = article.find('a', class_='result-item-title-link')
                    url = urljoin(self.base_url, link_elem['href']) if link_elem else 'N/A'
                    
                    result = {
                        'title': title,
                        'authors': [authors],
                        'year': year,
                        'venue': journal,
                        'abstract': 'No abstract available',
                        'url': url,
                        'citations': 0
                    }
                    results.append(result)
                    
                except Exception as e:
                    logger.warning(f"Error parsing ScienceDirect result: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"ScienceDirect search failed: {e}")
            return []

class SearchLogger:
    """Log search attempts, successes, and failures"""
    
    def __init__(self):
        self.search_log = []
    
    def log_search(self, tool_name: str, query: str, result_count: int, error: Optional[str] = None):
        """Log search results for debugging"""
        log_entry = {
            'timestamp': time.time(),
            'tool': tool_name,
            'query': query,
            'result_count': result_count,
            'error': error,
            'success': error is None
        }
        self.search_log.append(log_entry)
        
        if error:
            logger.warning(f"Search failed: {tool_name} - {error}")
        else:
            logger.info(f"Search successful: {tool_name} - {result_count} results")
    
    def get_search_stats(self) -> Dict:
        """Get search statistics"""
        if not self.search_log:
            return {}
        
        total_searches = len(self.search_log)
        successful_searches = sum(1 for log in self.search_log if log['success'])
        total_results = sum(log['result_count'] for log in self.search_log)
        
        tool_stats = {}
        for log in self.search_log:
            tool = log['tool']
            if tool not in tool_stats:
                tool_stats[tool] = {'searches': 0, 'successes': 0, 'results': 0}
            tool_stats[tool]['searches'] += 1
            if log['success']:
                tool_stats[tool]['successes'] += 1
            tool_stats[tool]['results'] += log['result_count']
        
        return {
            'total_searches': total_searches,
            'successful_searches': successful_searches,
            'success_rate': successful_searches / total_searches if total_searches > 0 else 0,
            'total_results': total_results,
            'avg_results_per_search': total_results / total_searches if total_searches > 0 else 0,
            'tool_stats': tool_stats
        }

# Global search logger instance
search_logger = SearchLogger()
