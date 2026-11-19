# 🧭 GenLaTeX – MVP “New Project” User Flow

Below is the structured user flow for creating new content (A new project) in **GenLaTeX**, designed for clarity, minimalism, and smooth AI integration.  
All article types share:
- Optional linking with **GitHub** or **Zotero** (where necessary).
- **Automatic citation inference** when relevant.
- **Two editor modes** only: **LaTeX** (structured) and **Tiptap** (rich text).
- **AI-assisted content generation** that adapts to user-provided data — the more data provided, the more accurate and contextual the generated result.

---

## 1️⃣ Research Article

### Step 1: Choose Format
> “Select paper format”
- IEEE  
- Springer  
- ACM  
- Custom (Upload files or folder)

### Step 2: Editor
> “Preferred editor”
- Pre-selected: **LaTeX**
- Optional: switch to **Tiptap editor**

### Step 3: Extra Material *(strongly recommended but optional and can add later on)*
> “Do you have code samples or datasets?”
- [ ] Link GitHub project  
- [ ] Upload code / analysis results  
- [ ] Upload files explaining methodology or setup or any other relevant material 

- [ ] Upload files review articles doi, link etc...

### Step 4: Publication Target
> “Where are you publishing?”
- Select from dropdown (IEEE Access, ICML, NeurIPS, etc.)  
- Or manually enter conference/journal name and link  

### Step 5: Confirm
- **Button:** `Create Research Article`  
- Display a short “AI Thinking” animation  
- **AI Action:** Generate initial paper structure and draft content based on provided inputs.

---

## 2️⃣ Review Articles

### Step 1: Choose Focus
> “What type of review?”
- Thematic / Topic-based  
- Chronological  
- Methodological  

### Step 2: Editor
> “Preferred editor”
- Suggested: **LaTeX**  
- Optional: toggle to **Tiptap**

### Step 3: Sources Input for AI *(recommended but optional)*
> “Upload PDFs or add DOIs to summarize”
- Upload research papers or add DOIs  
- Enable “AI enrichment” (default ON):  
  > Allow GenLaTeX to fetch and integrate additional relevant studies automatically.

### Step 4: Confirm
- **Preview sections**  
- **Button:** `Create Review Article`

---

## 3️⃣ Project / School Work / Technical Document

### Step 1: Choose Type
> “What kind of project?”
- Assignment  
- Thesis report  
- Project report  
- Technical documentation  

### Step 2: Select Editor Format
> “Preferred format”
- **LaTeX**  
- **Tiptap**

### Step 3: Attach Files *(optional but encouraged)*
> “Upload source files, data, or slides”
- Upload templates, source code, or answers  
- Option: allow AI to *analyze or solve assignments* and provide improvement recommendations  

### Step 4: Confirm
- **Button:** `Create Project Document`

---

## 4️⃣ Blog Post / Discussion Article

### Step 1: Describe Blog Post
> “Write your idea or blog summary”
- Pre-selected: **Tiptap document editor** (can switch to LaTeX if preferred)

### Step 2: Recommended Editor
> “Preferred editor”
- **Tiptap** preselected (LaTeX optional)

### Step 3: Optional Links / Data
> “Add external links, media embeds, or supporting materials”
- Add media, source links, related references, or discussion points

### Step 4: Confirm
- **Button:** `Create Blog Article`

---

## 🧠 AI Behavior Across All Types

- AI **analyzes** all provided data (files, links, DOIs, code).  
- If the user provides minimal input, GenLaTeX’s **research AI** autonomously gathers and integrates relevant information to produce a strong first draft.  
- The user can always **edit in either LaTeX or Tiptap**, preserving full control over structure and citations.

---

### ⚙️ Summary of Editor Recommendations

| Type | Recommended Editor | Alternatives |
|------|--------------------|--------------|
| Research Article | LaTeX | Tiptap |
| Review Article | LaTeX | Tiptap |
| Project / School Work | User chooses | LaTeX / Tiptap |
| Blog Post | Tiptap | LaTeX |

---
