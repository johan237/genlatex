#!/usr/bin/env python3
"""
Environment setup script for the AI Research Paper Generator API.
This script helps you create and configure your .env file.
"""

import os
import sys
from pathlib import Path

def main():
    """Main function to set up environment"""
    print("🔧 AI Research Paper Generator API - Environment Setup")
    print("=" * 60)
    
    # Check if .env already exists
    env_file = Path(".env")
    template_file = Path("env_template")
    
    if env_file.exists():
        print("⚠️  .env file already exists!")
        response = input("Do you want to overwrite it? (y/N): ").lower().strip()
        if response != 'y':
            print("Setup cancelled.")
            return
    
    if not template_file.exists():
        print("❌ env_template file not found!")
        print("Please make sure env_template exists in the current directory.")
        return
    
    # Read template
    with open(template_file, 'r') as f:
        template_content = f.read()
    
    print("\n📝 Setting up environment variables...")
    print("Press Enter to use default values (shown in brackets)")
    
    # Required variables
    print("\n🔑 REQUIRED API KEYS:")
    print("-" * 30)
    
    openrouter_key = input("OpenRouter API Key: ").strip()
    if not openrouter_key:
        print("❌ OpenRouter API Key is required!")
        print("Get your API key from: https://openrouter.ai/")
        return
    
    tavily_key = input("Tavily API Key (optional, press Enter to skip): ").strip()
    
    # Optional configuration
    print("\n⚙️  OPTIONAL CONFIGURATION:")
    print("-" * 30)
    
    template_dir = input("Template directory [./template]: ").strip() or "./template"
    checkpoint_dir = input("Checkpoint directory [./checkpoints]: ").strip() or "./checkpoints"
    output_dir = input("Output directory [./output]: ").strip() or "./output"
    
    max_papers = input("Max concurrent papers [5]: ").strip() or "5"
    timeout = input("Request timeout (seconds) [300]: ").strip() or "300"
    
    server_host = input("Server host [0.0.0.0]: ").strip() or "0.0.0.0"
    server_port = input("Server port [8000]: ").strip() or "8000"
    
    log_level = input("Log level [info]: ").strip() or "info"
    
    # Replace placeholders in template
    env_content = template_content
    env_content = env_content.replace("your_openrouter_api_key_here", openrouter_key)
    env_content = env_content.replace("your_tavily_api_key_here", tavily_key or "")
    env_content = env_content.replace("TEMPLATE_DIR=./template", f"TEMPLATE_DIR={template_dir}")
    env_content = env_content.replace("CHECKPOINT_DIR=./checkpoints", f"CHECKPOINT_DIR={checkpoint_dir}")
    env_content = env_content.replace("OUTPUT_DIR=./output", f"OUTPUT_DIR={output_dir}")
    env_content = env_content.replace("MAX_CONCURRENT_PAPERS=5", f"MAX_CONCURRENT_PAPERS={max_papers}")
    env_content = env_content.replace("REQUEST_TIMEOUT=300", f"REQUEST_TIMEOUT={timeout}")
    env_content = env_content.replace("SERVER_HOST=0.0.0.0", f"SERVER_HOST={server_host}")
    env_content = env_content.replace("SERVER_PORT=8000", f"SERVER_PORT={server_port}")
    env_content = env_content.replace("LOG_LEVEL=info", f"LOG_LEVEL={log_level}")
    
    # Write .env file
    with open(env_file, 'w') as f:
        f.write(env_content)
    
    print(f"\n✅ Environment file created: {env_file}")
    
    # Create directories
    directories = [template_dir, checkpoint_dir, output_dir, "./logs"]
    for directory in directories:
        Path(directory).mkdir(exist_ok=True, parents=True)
        print(f"📁 Created directory: {directory}")
    
    # Validate setup
    print("\n🔍 Validating setup...")
    validate_setup()
    
    print("\n🎉 Setup complete!")
    print("\nNext steps:")
    print("1. Start the API server: python run_api.py")
    print("2. Visit the API docs: http://localhost:8000/docs")
    print("3. Test the API: python example_api_usage.py")


def validate_setup():
    """Validate the environment setup"""
    env_file = Path(".env")
    
    if not env_file.exists():
        print("❌ .env file not found!")
        return False
    
    # Load environment variables
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key] = value
    
    # Check required variables
    required_vars = ['OPENROUTER_API_KEY']
    missing_vars = []
    
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        print(f"❌ Missing required variables: {', '.join(missing_vars)}")
        return False
    
    # Check optional variables
    optional_vars = ['TAVILY_API_KEY']
    missing_optional = []
    
    for var in optional_vars:
        if not os.getenv(var):
            missing_optional.append(var)
    
    if missing_optional:
        print(f"⚠️  Optional variables not set: {', '.join(missing_optional)}")
    
    # Check directories
    directories = [
        os.getenv('TEMPLATE_DIR', './template'),
        os.getenv('CHECKPOINT_DIR', './checkpoints'),
        os.getenv('OUTPUT_DIR', './output')
    ]
    
    for directory in directories:
        if not Path(directory).exists():
            print(f"⚠️  Directory does not exist: {directory}")
    
    print("✅ Environment validation passed!")
    return True


def show_current_config():
    """Show current configuration"""
    env_file = Path(".env")
    
    if not env_file.exists():
        print("❌ .env file not found!")
        return
    
    print("📋 Current Configuration:")
    print("-" * 40)
    
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                if 'KEY' in key or 'PASSWORD' in key:
                    # Mask sensitive values
                    if value and len(value) > 8:
                        masked_value = f"{value[:4]}...{value[-4:]}"
                    else:
                        masked_value = "***"
                    print(f"{key}: {masked_value}")
                else:
                    print(f"{key}: {value}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "show":
        show_current_config()
    else:
        main()
