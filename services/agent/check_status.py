import requests
import time

def check_paper_status():
    start = time.time()
    while time.time() - start < 60:  # Check for 1 minute
        try:
            r = requests.get('http://localhost:8000/papers/')
            papers = r.json()
            current = [p for p in papers if p['paper_id'] == 'paper_2_b10e328e'][0]
            print(f"Status: {current['status']}, Phase: {current['phase']}, Progress: {current['progress']}")
            
            if current['status'] in ['completed', 'failed']:
                print("Paper generation finished!")
                break
                
            time.sleep(3)
        except Exception as e:
            print(f"Error: {e}")
            break

if __name__ == "__main__":
    check_paper_status()
