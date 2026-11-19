#!/usr/bin/env python3
"""
Startup script for the AI Research Paper Generator API.
This script provides an easy way to start the FastAPI server with proper configuration.
"""

import os
import sys
import argparse
import uvicorn
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Add the current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

def main():
    """Main function to start the API server"""
    parser = argparse.ArgumentParser(
        description="Start the GenLaTeX Agent AI Research Module server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Start with default settings
  python run_api.py
  
  # Start on custom host and port
  python run_api.py --host 0.0.0.0 --port 8080
  
  # Start in production mode
  python run_api.py --production
  
  # Start with custom log level
  python run_api.py --log-level debug
        """
    )
    
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind the server to (default: 0.0.0.0)"
    )
    
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind the server to (default: 8000)"
    )
    
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development (default: False)"
    )
    
    parser.add_argument(
        "--production",
        action="store_true",
        help="Run in production mode (disables reload, uses production settings)"
    )
    
    parser.add_argument(
        "--log-level",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
        default="info",
        help="Log level (default: info)"
    )
    
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of worker processes (default: 1, use 1 for development)"
    )
    
    parser.add_argument(
        "--check-env",
        action="store_true",
        help="Check environment variables and exit"
    )
    
    args = parser.parse_args()
    
    # Check environment variables if requested
    if args.check_env:
        check_environment()
        return
    
    # Validate environment
    validate_environment()
    
    # Configure server settings
    if args.production:
        args.reload = False
        if args.workers == 1:
            args.workers = 4  # Default to 4 workers in production
    
    # Print startup information
    print("=" * 60)
    print("🚀 GenLaTeX Agent - AI Research Module")
    print("=" * 60)
    print(f"Host: {args.host}")
    print(f"Port: {args.port}")
    print(f"Workers: {args.workers}")
    print(f"Reload: {args.reload}")
    print(f"Log Level: {args.log_level}")
    print(f"Mode: {'Production' if args.production else 'Development'}")
    print("=" * 60)
    
    # Start the server
    try:
        uvicorn.run(
            "api.main:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
            workers=args.workers if not args.reload else 1,  # Reload only works with 1 worker
            log_level=args.log_level,
            access_log=True,
            use_colors=True
        )
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped by user")
    except Exception as e:
        print(f"\n\n❌ Failed to start server: {e}")
        sys.exit(1)


def validate_environment():
    """Validate required environment variables"""
    required_vars = ["OPENROUTER_API_KEY"]
    optional_vars = ["TAVILY_API_KEY"]
    
    missing_required = []
    for var in required_vars:
        if not os.getenv(var):
            missing_required.append(var)
    
    if missing_required:
        print("❌ Missing required environment variables:")
        for var in missing_required:
            print(f"   - {var}")
        print("\nPlease set these environment variables before starting the server.")
        sys.exit(1)
    
    # Check optional variables
    missing_optional = []
    for var in optional_vars:
        if not os.getenv(var):
            missing_optional.append(var)
    
    if missing_optional:
        print("⚠️  Optional environment variables not set:")
        for var in missing_optional:
            print(f"   - {var}")
        print("   (These are optional but may limit functionality)\n")


def check_environment():
    """Check and display environment configuration"""
    print("🔍 GenLaTeX Agent Environment Configuration")
    print("=" * 40)
    
    # Required variables
    required_vars = {
        "OPENROUTER_API_KEY": "OpenRouter API key (DeepSeek R1)",
    }
    
    # Optional variables
    optional_vars = {
        "TAVILY_API_KEY": "Tavily API key for web search",
        "TEMPLATE_DIR": "LaTeX template directory",
        "CHECKPOINT_DIR": "Checkpoint storage directory",
        "OUTPUT_DIR": "Output directory for generated files",
        "MAX_CONCURRENT_PAPERS": "Maximum concurrent paper generations",
        "REQUEST_TIMEOUT": "Request timeout in seconds",
    }
    
    print("Required Variables:")
    for var, description in required_vars.items():
        value = os.getenv(var)
        status = "✅ Set" if value else "❌ Missing"
        print(f"  {var}: {status}")
        if value:
            # Show first and last 4 characters for security
            masked = f"{value[:4]}...{value[-4:]}" if len(value) > 8 else "***"
            print(f"    Value: {masked}")
        print(f"    Description: {description}")
        print()
    
    print("Optional Variables:")
    for var, description in optional_vars.items():
        value = os.getenv(var)
        status = "✅ Set" if value else "⚪ Not set"
        print(f"  {var}: {status}")
        if value:
            print(f"    Value: {value}")
        print(f"    Description: {description}")
        print()
    
    # Check directories
    print("Directory Check:")
    directories = [
        ("Template Directory", os.getenv("TEMPLATE_DIR", "./template")),
        ("Checkpoint Directory", os.getenv("CHECKPOINT_DIR", "./checkpoints")),
        ("Output Directory", os.getenv("OUTPUT_DIR", "./output")),
    ]
    
    for name, path in directories:
        path_obj = Path(path)
        if path_obj.exists():
            print(f"  {name}: ✅ Exists ({path})")
        else:
            print(f"  {name}: ⚠️  Will be created ({path})")
    
    print("\n" + "=" * 40)


if __name__ == "__main__":
    main() 