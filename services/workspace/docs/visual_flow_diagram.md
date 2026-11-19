# Visual Flow Diagrams - File Management System

## Complete System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER ACTIONS                                   │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐       ┌──────────────┐
                    │ Create New   │       │ Open Existing│
                    │ Project      │       │ Project      │
                    └──────┬───────┘       └──────┬───────┘
                           │                      │
                           └──────────┬───────────┘
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │  Upload Research Files  │
                        │  (Regular + ZIP files)  │
                        └──────────┬──────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │                                                       │
        ▼                                                       ▼
┌───────────────┐                                      ┌───────────────┐
│  Is New       │                                      │  Is Existing  │
│  Project?     │                                      │  Project?     │
└───────┬───────┘                                      └───────┬───────┘
        │                                                      │
        │ YES                                                  │ YES
        ▼                                                      ▼
┌─────────────────────────────────────────────┐    ┌─────────────────────────────────────┐
│  SCENARIO A: NEW PROJECT UPLOAD             │    │  SCENARIO B: EXISTING PROJECT ADD   │
│                                              │    │                                     │
│  1. Extract ZIPs recursively                │    │  1. Extract ZIPs recursively        │
│  2. Save all files to disk                  │    │  2. Save all files to disk          │
│  3. Create DB records (status='pending')    │    │  3. Create DB records ('processing')│
│  4. Return immediately (no processing)      │    │  4. Call Python batch processor     │
│                                              │    │  5. Wait for processing completion  │
│  ✅ Fast upload, deferred processing        │    │  6. Update DB with metadata         │
│                                              │    │  ✅ Files ready immediately          │
└──────────────────┬──────────────────────────┘    └─────────────────┬───────────────────┘
                   │                                                  │
                   │                                                  │
                   └──────────────────┬───────────────────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │   USER CONTINUES...     │
                        └──────────┬──────────────┘
                                   │
                                   ▼
                        ┌─────────────────────────┐
                        │ Click "Generate Paper"  │
                        └──────────┬──────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │                                                       │
        ▼                                                       ▼
┌─────────────────────┐                              ┌─────────────────────┐
│  From Scenario A?   │                              │  From Scenario B?   │
│  (pending files)    │                              │  (already processed)│
└─────────┬───────────┘                              └─────────┬───────────┘
          │                                                    │
          │ YES                                                │ YES
          ▼                                                    ▼
┌──────────────────────────────────┐              ┌───────────────────────┐
│  PROCESS FILES FIRST             │              │  SKIP PROCESSING      │
│  (Deferred Processing)           │              │  (Already done)       │
│                                   │              │                       │
│  1. Get all pending files         │              │  1. Get processed     │
│  2. Call batch processor          │              │     files directly    │
│  3. Wait for completion           │              │                       │
│  4. Update DB with metadata       │              │                       │
└──────────────┬───────────────────┘              └───────────┬───────────┘
               │                                               │
               └───────────────────┬───────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   GENERATE ARTICLE           │
                    │   (Python Agent with Tools)  │
                    │                              │
                    │  AI calls:                   │
                    │  • list_available_files()    │
                    │  • search_files()            │
                    │  • get_file_metadata()       │
                    │  • read_file_content()       │
                    │  • search_file_content()     │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Article Generated! ✅       │
                    │   Save to project            │
                    │   Log file usage             │
                    └──────────────────────────────┘
```

---

## ZIP Extraction Flow

```
┌─────────────────────────────────┐
│  User uploads research.zip       │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Extract ZIP to project directory           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  For each file │
        │  in ZIP:       │
        └────────┬───────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌──────────┐           ┌──────────┐
│Is it a   │           │Is it a   │
│ZIP file? │           │supported │
└────┬─────┘           │file type?│
     │                 └────┬─────┘
     │ YES                  │
     ▼                      │ YES
┌─────────────────┐         │
│ Extract         │         ▼
│ recursively     │   ┌──────────────┐
│ (up to 5 levels)│   │ Add to file  │
└────────┬────────┘   │ list         │
         │            └──────┬───────┘
         └────────────────┬──┘
                          │
                    NO    ▼
              ┌───────────────────┐
              │ Skip unsupported  │
              │ (log warning)     │
              └───────────────────┘

Final Result:
┌─────────────────────────────────────┐
│  All supported files extracted      │
│  and added to research_files table  │
└─────────────────────────────────────┘
```

---

## Large File Chunking Flow

```
┌──────────────────────────────┐
│  File content extracted       │
│  Size: 150,000 characters    │
└────────────┬─────────────────┘
             │
             ▼
      ┌──────────────┐
      │ Size > 10,000?│
      └──────┬───────┘
             │ YES
             ▼
┌─────────────────────────────┐
│  Split into chunks          │
│  (10,000 chars each)        │
│                             │
│  Chunk 1: chars 0-10000     │
│  Chunk 2: chars 10000-20000 │
│  ...                        │
│  Chunk 15: chars 140000-end │
└─────────────┬───────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  PROGRESSIVE SUMMARIZATION            │
  │                                       │
  │  Iteration 1:                         │
  │  ├─ Process Chunk 1                   │
  │  └─ Generate Summary 1                │
  │                                       │
  │  Iteration 2:                         │
  │  ├─ Process Chunk 2                   │
  │  ├─ Read Summary 1 (context)          │
  │  └─ Generate Summary 2 (cumulative)   │
  │                                       │
  │  Iteration 3:                         │
  │  ├─ Process Chunk 3                   │
  │  ├─ Read Summary 2 (context)          │
  │  └─ Generate Summary 3 (cumulative)   │
  │                                       │
  │  ...continues for all chunks          │
  │                                       │
  │  Iteration 15:                        │
  │  ├─ Process Chunk 15                  │
  │  ├─ Read Summary 14 (context)         │
  │  └─ Generate FINAL Summary            │
  └───────────────┬───────────────────────┘
                  │
                  ▼
    ┌──────────────────────────────┐
    │  Final comprehensive summary  │
    │  (captures entire file)       │
    │                               │
    │  Use for metadata generation  │
    └───────────────────────────────┘
```

---

## PDF OCR Flow

```
┌──────────────────────────────┐
│  PDF file uploaded            │
└────────────┬─────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Open PDF with pdfplumber            │
└────────────┬────────────────────────┘
             │
             ▼
    ┌────────────────┐
    │  For each page │
    └────────┬───────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌──────────┐    ┌──────────┐
│ Extract  │    │ Detect   │
│ text     │    │ images   │
└────┬─────┘    └────┬─────┘
     │               │
     │               ▼
     │         ┌──────────┐
     │         │ Any      │
     │         │ images?  │
     │         └────┬─────┘
     │              │ YES
     │              ▼
     │    ┌─────────────────────┐
     │    │ For each image:     │
     │    │ 1. Extract image    │
     │    │ 2. Convert to PIL   │
     │    │ 3. Run Tesseract    │
     │    │ 4. Get OCR text     │
     │    └─────────┬───────────┘
     │              │
     └──────────────┴──────┐
                           │
                           ▼
              ┌────────────────────────┐
              │ Combine:               │
              │ • Regular text         │
              │ • OCR text from images │
              │                        │
              │ Result: Full PDF text  │
              └────────────────────────┘
```

---

## File Processing Batch Flow

```
┌─────────────────────────────────────┐
│  Batch processing request           │
│  Files: [file1, file2, ..., file20] │
└────────────────┬────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  For each file │
        │  (sequential)  │
        └────────┬───────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌────────────────┐    ┌──────────────────┐
│ Detect type    │───▶│ Select extractor │
└────────────────┘    └─────────┬────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Extract content:      │
                    │                       │
                    │ CSV → pandas          │
                    │ PDF → pdfplumber+OCR  │
                    │ Notebook → nbformat   │
                    │ Code → AST parser     │
                    │ BibTeX → parser       │
                    └──────────┬────────────┘
                               │
                               ▼
                    ┌───────────────────┐
                    │ Large file?       │
                    └──────┬────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
                YES ▼             ▼ NO
         ┌──────────────┐  ┌─────────────┐
         │ Progressive  │  │ Use content │
         │ chunking     │  │ directly    │
         └──────┬───────┘  └──────┬──────┘
                │                 │
                └────────┬────────┘
                         │
                         ▼
              ┌────────────────────┐
              │ Generate metadata  │
              │ with AI            │
              └──────────┬─────────┘
                         │
                         ▼
              ┌────────────────────┐
              │ Return metadata    │
              │ JSON               │
              └────────────────────┘

After all files processed:
┌──────────────────────────────────┐
│ Return batch results:            │
│ {                                │
│   "results": [...],              │
│   "processed": 18,               │
│   "failed": 2                    │
│ }                                │
└──────────────────────────────────┘
```

---

## AI Function Calling During Generation

```
┌─────────────────────────────────────┐
│  Python Agent starts generation     │
│  with research files available      │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  AI Receives:                                   │
│  • Generation instructions                      │
│  • List of available files (metadata preview)  │
│  • Tool definitions                             │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ AI Planning    │
        │ Phase          │
        └────────┬───────┘
                 │
                 ▼
    "I need to see what files are available"
                 │
                 ▼
    ┌─────────────────────────────┐
    │ Tool Call:                   │
    │ list_available_files()       │
    └──────────┬──────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Returns:                         │
    │ [                                │
    │   {                              │
    │     "fileId": "abc123",          │
    │     "fileName": "dataset.csv",   │
    │     "fileType": "csv",           │
    │     "about": "Experimental...",  │
    │     "keywords": [...]            │
    │   },                             │
    │   ...                            │
    │ ]                                │
    └──────────┬───────────────────────┘
               │
               ▼
    "I need files about experiments"
               │
               ▼
    ┌─────────────────────────────┐
    │ Tool Call:                   │
    │ search_files("experiment")   │
    └──────────┬──────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Returns ranked results:          │
    │ [                                │
    │   {                              │
    │     "fileId": "abc123",          │
    │     "relevanceScore": 0.92,      │
    │     "summary": "...",            │
    │     "keyPoints": [...]           │
    │   }                              │
    │ ]                                │
    └──────────┬───────────────────────┘
               │
               ▼
    "Let me get detailed info on abc123"
               │
               ▼
    ┌─────────────────────────────────┐
    │ Tool Call:                       │
    │ get_file_metadata("abc123")      │
    └──────────┬────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Returns full metadata:           │
    │ {                                │
    │   "about": "...",                │
    │   "summary": "...",              │
    │   "keyPoints": [...],            │
    │   "keywords": [...],             │
    │   "structure": {...}             │
    │ }                                │
    └──────────┬───────────────────────┘
               │
               ▼
    "I need to read the actual data"
               │
               ▼
    ┌─────────────────────────────────┐
    │ Tool Call:                       │
    │ read_file_content("abc123")      │
    └──────────┬────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Returns file content:            │
    │ {                                │
    │   "content": "actual CSV data",  │
    │   "lines": 1000,                 │
    │   "truncated": true              │
    │ }                                │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ AI uses data to write article    │
    │ Cites sources appropriately      │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Article generation complete!     │
    │                                  │
    │ Returns:                         │
    │ • Generated LaTeX                │
    │ • Usage log (which files used)   │
    └──────────────────────────────────┘
```

---

## Storage Quota Check Flow

```
┌─────────────────────────────────┐
│  User attempts file upload       │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  Check storage quota:               │
│  1. Get user tier (free/pro)        │
│  2. Get project current size        │
│  3. Get project file count          │
└────────────────┬────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐   ┌──────────────┐
│ File size    │   │ Project total│
│ > 100MB?     │   │ exceeded?    │
└──────┬───────┘   └──────┬───────┘
       │ YES              │ YES
       ▼                  ▼
┌──────────────┐   ┌──────────────┐
│ REJECT       │   │ REJECT       │
│ "File too    │   │ "Project     │
│  large"      │   │  quota full" │
└──────────────┘   └──────────────┘

       │ NO               │ NO
       ▼                  ▼
┌──────────────────────────────────┐
│  Check file count:               │
│  • Free: max 50 files            │
│  • Pro: max 500 files            │
└──────────┬───────────────────────┘
           │
    ┌──────┴──────┐
    │             │
YES ▼             ▼ NO
┌──────────┐  ┌─────────────┐
│ REJECT   │  │ ALLOW       │
│ "Too many│  │ Upload ✅    │
│  files"  │  │             │
└──────────┘  └─────────────┘
```

---

## Error Handling Flow

```
┌──────────────────────────────┐
│  File processing attempt      │
└────────────────┬─────────────┘
                 │
        ┌────────┴────────┐
        │ Try processing  │
        └────────┬────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
OK  ▼                         ▼ ERROR
┌─────────────┐      ┌─────────────────┐
│ Save        │      │ Handle error:   │
│ metadata    │      │                 │
│ status:     │      │ 1. Log error    │
│ 'completed' │      │ 2. Save to DB:  │
└─────────────┘      │    status:      │
                     │    'failed'     │
                     │ 3. Create       │
                     │    fallback     │
                     │    metadata     │
                     └─────────┬───────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │ Fallback metadata:       │
                  │ {                        │
                  │   "about": "File type",  │
                  │   "summary": "Error...", │
                  │   "keyPoints": [],       │
                  │   "keywords": [type]     │
                  │ }                        │
                  └──────────────────────────┘

File is still saved and available, just with minimal metadata
User can manually review or re-process later
```

---

## Summary: Key Decision Points

| Decision Point | Condition | Action |
|----------------|-----------|--------|
| **Project Type** | New project | Upload only, defer processing |
| | Existing project | Upload + process immediately |
| **File Type** | ZIP file | Extract recursively |
| | Regular file | Save directly |
| **File Size** | > 10,000 chars | Use progressive chunking |
| | < 10,000 chars | Process directly |
| **PDF Content** | Has images | Apply Tesseract OCR |
| | Text only | Extract text |
| **Generation Time** | Has pending files | Process first, then generate |
| | All processed | Generate immediately |
| **Storage** | Exceeds quota | Reject upload |
| | Within quota | Allow upload |

---

This visual guide should help understand the complete flow at a glance! 🎯
