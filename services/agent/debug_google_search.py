#!/usr/bin/env python3
"""
Debug script to test Google Images search and see the actual HTML response.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from utils.image_fetcher import ImageFetcher

def debug_search():
    print("=" * 60)
    print("DEBUGGING GOOGLE IMAGES SEARCH")
    print("=" * 60)
    print()

    fetcher = ImageFetcher()

    # Test search
    query = "sunset"
    print(f"Searching for: '{query}'")
    print()

    try:
        # Perform search
        result = fetcher.search_image(query)

        if result:
            print("[OK] Search successful!")
            print(f"Image URL: {result['url']}")
            print(f"Description: {result['description']}")
            print(f"Source: {result['source']}")
        else:
            print("[WARN] No results returned")
            print()
            print("This could mean:")
            print("1. Google is blocking the scraper")
            print("2. HTML structure has changed")
            print("3. Rate limiting in effect")
            print()
            print("Attempting direct test...")

            # Try direct request
            import httpx
            from urllib.parse import quote_plus

            search_query = quote_plus(query)
            url = f"https://www.google.com/search?q={search_query}&tbm=isch&tbs=isz:l"

            print(f"URL: {url}")
            response = fetcher.client.get(url)
            print(f"Status Code: {response.status_code}")
            print(f"Response Length: {len(response.text)} bytes")

            # Check for common blocking indicators
            if "unusual traffic" in response.text.lower():
                print("[WARN] Google is blocking - detected 'unusual traffic' message")
            elif "captcha" in response.text.lower():
                print("[WARN] Google is blocking - CAPTCHA required")
            else:
                print("[INFO] No obvious blocking detected")

                # Try to find image URLs
                import re
                pattern = r'"ou":"(https?://[^"]+)"'
                matches = re.findall(pattern, response.text)
                print(f"[INFO] Found {len(matches)} potential image URLs in HTML")

                if matches:
                    print("[OK] Found image URLs - extraction regex works")
                    print(f"First URL sample: {matches[0][:80]}...")
                else:
                    print("[WARN] No image URLs found - HTML structure may have changed")

                    # Show sample of HTML
                    print("\nHTML Sample (first 500 chars):")
                    print("-" * 60)
                    print(response.text[:500])
                    print("-" * 60)

    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()

    finally:
        fetcher.close()

    print()
    print("=" * 60)
    print("DEBUG COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    debug_search()
