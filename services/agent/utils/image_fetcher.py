"""
Image fetcher using Google Images web scraping.
Fetches relevant images from Google Images for LaTeX documents.
NOTE: This uses web scraping which may be less reliable than APIs.
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
import httpx
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)


class ImageFetcher:
    """Fetches relevant images from Google Images using web scraping."""

    def __init__(self):
        # Browser-like headers to avoid being blocked
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        self.client = httpx.Client(timeout=30.0, headers=self.headers, follow_redirects=True)

    def search_image(self, query: str, per_page: int = 1) -> Optional[Dict[str, Any]]:
        """
        Search for an image on Google Images.

        Args:
            query: Search query (e.g., "technology", "brain", "data")
            per_page: Number of results to return (default: 1)

        Returns:
            Dict with image data or None if not found
        """
        try:
            # Construct Google Images search URL
            search_query = quote_plus(query)
            url = f"https://www.google.com/search?q={search_query}&tbm=isch&tbs=isz:l"  # isz:l = large images

            logger.info(f"Searching Google Images for: {query}")
            response = self.client.get(url)
            response.raise_for_status()

            # Extract image URLs from the page
            image_urls = self._extract_image_urls(response.text)

            if not image_urls:
                logger.warning(f"No images found for query: {query}")
                return None

            # Return first valid result
            image_url = image_urls[0]
            return {
                "id": query.replace(" ", "_"),
                "url": image_url,
                "description": query,
                "source": "Google Images"
            }

        except Exception as e:
            logger.error(f"Failed to search Google Images for '{query}': {e}")
            return None

    def _extract_image_urls(self, html_content: str) -> List[str]:
        """
        Extract image URLs from Google Images HTML.

        Args:
            html_content: HTML content from Google Images page

        Returns:
            List of image URLs
        """
        image_urls = []

        try:
            # Method 1: Extract from AF_initDataCallback JSON structures (current Google format)
            # Google uses JavaScript initialization with JSON data
            af_pattern = r'AF_initDataCallback\({[^}]*data:function\(\){return (.*?)}\s*}\);'
            af_matches = re.findall(af_pattern, html_content, re.DOTALL)

            for match in af_matches:
                # Look for URLs within the JSON-like structures
                url_patterns = [
                    r'"(https?://[^"]*\.(?:jpg|jpeg|png|gif|webp)[^"]*)"',
                    r"'(https?://[^']*\.(?:jpg|jpeg|png|gif|webp)[^']*)'",
                ]

                for url_pattern in url_patterns:
                    urls = re.findall(url_pattern, match, re.IGNORECASE)
                    for url in urls:
                        if self._is_valid_image_url(url):
                            image_urls.append(url)
                            if len(image_urls) >= 10:
                                return image_urls

            # Method 2: Extract from older "ou" format (may still exist)
            if not image_urls:
                pattern = r'"ou":"(https?://[^"]+)"'
                matches = re.findall(pattern, html_content)
                for url in matches:
                    if self._is_valid_image_url(url):
                        image_urls.append(url)
                        if len(image_urls) >= 10:
                            return image_urls

            # Method 3: Extract any HTTPS URLs that look like images
            if not image_urls:
                generic_pattern = r'https?://[^\s"\'<>]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"\'<>]*)?'
                matches = re.findall(generic_pattern, html_content, re.IGNORECASE)
                for url in matches:
                    if self._is_valid_image_url(url):
                        image_urls.append(url)
                        if len(image_urls) >= 10:
                            return image_urls

            # Method 4: Fallback - extract direct img src URLs
            if not image_urls:
                img_pattern = r'<img[^>]+src="(https?://[^"]+)"'
                img_matches = re.findall(img_pattern, html_content)
                for url in img_matches:
                    if self._is_valid_image_url(url) and 'google' not in url.lower():
                        image_urls.append(url)
                        if len(image_urls) >= 10:
                            return image_urls

        except Exception as e:
            logger.error(f"Error extracting image URLs: {e}")

        return image_urls

    def _is_valid_image_url(self, url: str) -> bool:
        """
        Check if URL is a valid direct image URL.

        Args:
            url: URL to validate

        Returns:
            True if valid direct image URL, False otherwise
        """
        # Check for common image extensions
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
        url_lower = url.lower()

        # Must have image extension
        has_extension = any(ext in url_lower for ext in image_extensions)
        if not has_extension:
            return False

        # Exclude wiki page URLs (we want direct image URLs, not pages)
        if '/wiki/' in url_lower or 'wikipedia' in url_lower or 'wikimedia.org/wiki' in url_lower:
            return False

        # Exclude Google's own UI images
        if 'gstatic' in url_lower or 'googleusercontent' in url_lower:
            return False

        # Exclude tracking pixels and tiny images
        if 'tracking' in url_lower or 'pixel' in url_lower or '1x1' in url_lower:
            return False

        # Must be a reasonable length
        if len(url) < 30:
            return False

        # Prefer direct file URLs (ending with image extension, possibly with query params)
        # This filters out most page URLs and keeps direct image URLs
        return True

    def download_image(self, image_url: str, save_path: Path) -> bool:
        """
        Download image from URL to local file.

        Args:
            image_url: URL of the image
            save_path: Path where to save the image

        Returns:
            True if successful, False otherwise
        """
        try:
            # Ensure parent directory exists
            save_path.parent.mkdir(parents=True, exist_ok=True)

            logger.info(f"Downloading image from: {image_url}")

            # Download image with timeout
            response = self.client.get(image_url, timeout=20.0)
            response.raise_for_status()

            # Verify it's actually an image
            content_type = response.headers.get('content-type', '')
            if 'image' not in content_type.lower() and len(response.content) < 1000:
                logger.error(f"Downloaded content doesn't appear to be an image: {content_type}")
                return False

            # Save to file
            save_path.write_bytes(response.content)
            logger.info(f"✅ Downloaded image to: {save_path} ({len(response.content)} bytes)")

            return True

        except httpx.TimeoutException:
            logger.error(f"Timeout downloading image from: {image_url}")
            return False
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error downloading image: {e.response.status_code}")
            return False
        except Exception as e:
            logger.error(f"Failed to download image from {image_url}: {e}")
            return False

    def fetch_and_save(self, query: str, save_path: Path) -> bool:
        """
        Search for image and save it.

        Args:
            query: Search query
            save_path: Where to save the image

        Returns:
            True if successful, False otherwise
        """
        # Search for image
        image_data = self.search_image(query)
        if not image_data:
            logger.warning(f"No image found for query: {query}")
            return False

        # Try downloading the image
        success = self.download_image(image_data["url"], save_path)

        # If first URL fails, try searching for more and attempt others
        if not success:
            logger.info(f"First image failed, searching for alternatives for: {query}")
            # Could implement retry logic here if needed

        return success

    def extract_keywords_from_request(self, request: str) -> List[str]:
        """
        Extract image keywords from user request.

        Args:
            request: User's message

        Returns:
            List of keywords for image search
        """
        # Common patterns for image requests
        patterns = [
            r"image of (?:a |an )?(.+)",
            r"picture of (?:a |an )?(.+)",
            r"photo of (?:a |an )?(.+)",
            r"graphic of (?:a |an )?(.+)",
            r"illustration of (?:a |an )?(.+)",
            r"add (.+) image",
            r"insert (.+) picture",
            r"add (.+) photo",
            r"show (.+) image",
        ]

        keywords = []
        request_lower = request.lower()

        for pattern in patterns:
            matches = re.findall(pattern, request_lower)
            keywords.extend(matches)

        # Clean keywords
        cleaned = []
        for kw in keywords:
            # Remove common stop words and clean up
            kw = re.sub(r'\b(a|an|the|for|slide|slides|about|some|to|of)\b', '', kw)
            kw = kw.strip()
            if kw and len(kw) > 2:
                cleaned.append(kw)

        return cleaned

    def close(self):
        """Close HTTP client."""
        self.client.close()


# Singleton instance
_fetcher_instance = None


def get_image_fetcher() -> ImageFetcher:
    """Get singleton ImageFetcher instance."""
    global _fetcher_instance
    if _fetcher_instance is None:
        _fetcher_instance = ImageFetcher()
    return _fetcher_instance
