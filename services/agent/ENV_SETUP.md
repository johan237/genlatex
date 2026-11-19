# Environment Variables Setup

## Quick Start

1. **Copy the example file:**
   ```bash
   cp env.example .env
   ```

2. **Edit `.env` and add your API keys:**
   ```bash
   # Required
   OPENROUTER_API_KEY=sk-or-v1-xxxxx
   TAVILY_API_KEY=tvly-xxxxx
   ```

3. **Run without CLI arguments:**
   ```bash
   python main.py --topic "Your Topic" --description "Your description"
   ```

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | `sk-or-v1-xxxxx` |
| `TAVILY_API_KEY` | Tavily search API key | `tvly-xxxxx` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_MODEL` | `deepseek/deepseek-r1:free` | LLM model to use |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API base URL |
| `VISION_OCR_MODEL` | `deepseek/deepseek-ocr` | Vision OCR model for image text extraction |
| `VISION_CAPTION_MODEL` | `deepseek/deepseek-ocr` | Vision model for image captioning |
| `GENLATEX_APP_URL` | (unset) | Base URL of the GenLaTeX web app for persisting ingested images (e.g. `http://localhost:3000`) |
| `GENLATEX_MAX_TOOL_ITERATIONS` | (unset) | Optional. Max tool rounds for chat. Set to 24 or 30 if you hit "tool limit" when adding references or content. Only increases the cap. |
| `PAPER_TOPIC` | - | Default paper topic |
| `PAPER_DESCRIPTION` | - | Default paper description |
| `PAPER_PAGES` | `8` | Target number of pages |
| `OUTPUT_DIR` | `./output` | Output directory path |
| `CHECKPOINT_DIR` | `./checkpoints` | Checkpoint directory path |
| `TEMPLATE_DIR` | `./template` | LaTeX template directory |
| `FAST_MODE` | `false` | Enable fast mode (fewer sources) |

### Advanced Research Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RESEARCH_MAX_ITERATIONS` | `15` | Max LLM iterations for research |
| `RESEARCH_SOURCES_PER_SECTION` | `10` | Target sources per section |
| `RESEARCH_SOURCES_PER_BATCH` | `3` | Sources per batch multiplier |

## Usage Examples

### Using .env file only:
```bash
# Set everything in .env
OPENROUTER_API_KEY=sk-or-v1-xxxxx
TAVILY_API_KEY=tvly-xxxxx
PAPER_TOPIC=Quantum Computing
PAPER_DESCRIPTION=Survey of quantum algorithms
PAPER_PAGES=12

# Run with minimal command
python main.py
```

### Mix .env and CLI (CLI overrides .env):
```bash
# .env has API keys
OPENROUTER_API_KEY=sk-or-v1-xxxxx
TAVILY_API_KEY=tvly-xxxxx

# Override topic via CLI
python main.py --topic "Different Topic" --description "Different description"
```

### Fast Mode:
```bash
# In .env
FAST_MODE=true

# Or via CLI
python main.py --fast-mode --topic "Topic" --description "Description"
```

## Getting API Keys

### OpenRouter API Key
1. Go to https://openrouter.ai/
2. Sign up for an account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-or-v1-`)

### Tavily API Key
1. Go to https://tavily.com/
2. Sign up for an account
3. Get your API key from the dashboard
4. Copy the key (starts with `tvly-`)

## Troubleshooting

### "No module named 'dotenv'"
Install python-dotenv:
```bash
pip install python-dotenv
```

### "API key is required"
Make sure your `.env` file:
- Is in the `genlatex-agent` directory
- Has no typos in variable names
- Has actual API keys (not placeholder text)
- Is named exactly `.env` (not `env.txt` or `.env.example`)

### "JSON error injected into SSE stream"
This is an OpenRouter API streaming error. The fix has been applied:
- Streaming is now disabled by default (`streaming=False`)
- This prevents Server-Sent Events (SSE) corruption errors
- If you still see this, check your network connection or try a different model

### Getting placeholder/dummy references
If `references.bib` contains fake sources (e.g., "https://example.org/placeholder"), it means:
1. Research agent couldn't find real sources
2. Check terminal output for "PLACEHOLDER fallback sources" warning
3. Solutions:
   - Disable fast mode: `FAST_MODE=false`
   - Increase iterations: `RESEARCH_MAX_ITERATIONS=20`
   - Check API keys are valid
   - Verify network connectivity to search APIs

### Check if .env is loaded:
```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('OPENROUTER_API_KEY:', os.getenv('OPENROUTER_API_KEY')[:20] if os.getenv('OPENROUTER_API_KEY') else 'NOT SET')"
```
