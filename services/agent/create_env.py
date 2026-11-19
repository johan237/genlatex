#!/usr/bin/env python3
"""
Simple script to create .env file from template.
Run this script to set up your environment configuration.
"""

import shutil
from pathlib import Path

def main():
    """Create .env file from template"""
    template_file = Path("env_template")
    env_file = Path(".env")
    
    if not template_file.exists():
        print("❌ env_template file not found!")
        print("Please make sure env_template exists in the current directory.")
        return
    
    if env_file.exists():
        print("⚠️  .env file already exists!")
        response = input("Do you want to overwrite it? (y/N): ").lower().strip()
        if response != 'y':
            print("Operation cancelled.")
            return
    
    # Copy template to .env
    shutil.copy2(template_file, env_file)
    
    print("✅ .env file created from template!")
    print("\n📝 Next steps:")
    print("1. Edit .env file and add your API keys:")
    print("   - OPENROUTER_API_KEY=your_actual_key_here")
    print("   - TAVILY_API_KEY=your_actual_key_here (optional)")
    print("\n2. Run the setup script for interactive configuration:")
    print("   python setup_env.py")
    print("\n3. Or start the API server directly:")
    print("   python run_api.py")

if __name__ == "__main__":
    main()
