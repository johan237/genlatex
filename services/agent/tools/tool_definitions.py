"""
Tool definitions for AI function calling (OpenAI/Anthropic format)
"""

FILE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_available_files",
            "description": "Lists all research files uploaded by the user for this project. Returns file names, types, brief descriptions, and keywords to help you decide which files to examine more closely.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional: Filter by file types (e.g., ['csv', 'json', 'ipynb'])"
                    },
                    "keywords": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional: Filter files by keywords"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of files to return (default: 50)"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Searches through file metadata using keywords or natural language query. Returns ranked list of files that best match your search, with relevance scores.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (e.g., 'experimental data about temperature effects')"
                    },
                    "file_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional: Limit search to specific file types"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (default: 10)"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_file_metadata",
            "description": "Gets detailed metadata for a specific file, including comprehensive summary, key points, keywords, and structural information. Use this before reading the full file to understand its contents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The unique identifier of the file"
                    }
                },
                "required": ["file_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file_content",
            "description": "Reads the actual content of a file. This is a detailed read operation - only use this for files you've determined are relevant. Can read full file or limit lines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The unique identifier of the file to read"
                    },
                    "max_lines": {
                        "type": "integer",
                        "description": "Optional: Maximum lines to read (default: 1000)"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["text"],
                        "description": "Output format (default: 'text')"
                    }
                },
                "required": ["file_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_file_content",
            "description": "Searches for specific information within a file's content. Useful for finding particular data points, code sections, or text passages without reading the entire file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The file to search within"
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query or pattern to find"
                    },
                    "context_lines": {
                        "type": "integer",
                        "description": "Number of context lines around matches (default: 3)"
                    }
                },
                "required": ["file_id", "query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_file_chunks",
            "description": "Gets chunk information for a file with extracted content (PDF, DOCX, XLSX). Returns list of chunks with page ranges, useful for navigating large documents. Use this before read_chunk to understand document structure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The unique identifier of the file"
                    }
                },
                "required": ["file_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_chunk",
            "description": "Reads a specific chunk from a file with extracted content. Each chunk contains content from a range of pages. Use get_file_chunks first to see available chunks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The unique identifier of the file"
                    },
                    "chunk_id": {
                        "type": "integer",
                        "description": "The chunk number to read (1-indexed)"
                    }
                },
                "required": ["file_id", "chunk_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_page_range",
            "description": "Reads content from a specific page range in a PDF or document. Useful when you know exactly which pages contain relevant information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The unique identifier of the file"
                    },
                    "start_page": {
                        "type": "integer",
                        "description": "Starting page number (1-indexed)"
                    },
                    "end_page": {
                        "type": "integer",
                        "description": "Ending page number (inclusive, defaults to start_page)"
                    }
                },
                "required": ["file_id", "start_page"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_extracted_content",
            "description": "Searches within extracted content of PDFs/documents and returns matches with page references. Better than search_file_content for binary files as it provides page numbers for citations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {
                        "type": "string",
                        "description": "The file to search within"
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query to find"
                    },
                    "context_chars": {
                        "type": "integer",
                        "description": "Characters of context around matches (default: 200)"
                    }
                },
                "required": ["file_id", "query"]
            }
        }
    }
]
