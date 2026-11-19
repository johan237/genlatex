# Border Styles - Pre-Validated LaTeX Packages

## Overview

This directory contains **pre-validated, production-ready** border style packages for LaTeX documents. All packages are tested and guaranteed to compile without errors.

## Available Border Packages

### 1. `simple-borders.sty`
**Basic borders using built-in LaTeX commands**

- ✅ No external dependencies (except xcolor, fancybox)
- ✅ Fast compilation
- ✅ Works with all document classes

**Commands:**
```latex
\usepackage{simple-borders}

\simplebox{Text with simple border}
\roundbox{Text with rounded corners}
\thickbox{Text with thick border}
\shadowbox{Text with shadow}
\doublebox{Text with double border}

% Colored borders
\graybox{Gray bordered text}
\bluebox{Blue bordered text}
\greenbox{Green bordered text}
\redbox{Red bordered text (for warnings)}

% Environment for entire sections
\begin{bordersection}
Content with border around it
\end{bordersection}
```

### 2. `section-borders.sty`
**Advanced section borders using mdframed**

- ✅ Beautiful colored borders
- ✅ Background colors
- ✅ Shadow effects
- ✅ Rounded corners
- ✅ Left-bar accents

**Environments:**
```latex
\usepackage{section-borders}

% Full bordered sections
\begin{bluesection}
Information content
\end{bluesection}

\begin{greensection}
Positive findings or recommendations
\end{greensection}

\begin{redsection}
Warnings or critical points
\end{redsection}

\begin{orangesection}
Caution notes
\end{orangesection}

\begin{graysection}
Neutral content
\end{graysection}

% Left-bar accent borders
\begin{leftbarblue}
Quote or highlighted text
\end{leftbarblue}

\begin{leftbargreen}
Success note
\end{leftbargreen}

% Special effects
\begin{shadowsection}
Content with shadow effect
\end{shadowsection}

\begin{roundedblue}
Rounded corner border
\end{roundedblue}

\begin{roundedgreen}
Rounded green border
\end{roundedgreen}
```

### 3. `page-borders.sty`
**Full page borders for entire document**

- ✅ Borders around every page
- ✅ Multiple styles available
- ✅ Easy to enable/disable

**Commands:**
```latex
\usepackage{page-borders}

% Choose ONE in your preamble:
\enablesimplepageorder      % Simple single-line border
\enabledoublepageorder      % Double-line border
\enablebluepageorder        % Blue colored border
\enablegreenpageorder       % Green colored border
\enablethickpageorder       % Thick bold border
\enablecornerpageorder      % Decorative corner accents

% To remove page borders:
\disablepageorders
```

## Complete Usage Example

```latex
\documentclass{article}
\usepackage{simple-borders}
\usepackage{section-borders}
\usepackage{page-borders}

% Enable page borders (optional)
\enablesimplepageorder

\begin{document}

\section{Introduction}
This is regular text without borders.

\simplebox{This is a simple box with a border.}

\begin{bluesection}
\textbf{Key Finding:} This section has a blue border with light blue background, perfect for highlighting important information.
\end{bluesection}

\begin{greensection}
\textbf{Recommendation:} Use green borders for positive recommendations or success stories.
\end{greensection}

\begin{redsection}
\textbf{Warning:} Red borders are ideal for warnings, risks, or critical information that needs attention.
\end{redsection}

\begin{leftbarblue}
``This is a quote or highlighted text with a left bar accent.''
\end{leftbarblue}

\bluebox{Inline blue box for short notes or callouts.}

\end{document}
```

## Color Schemes

All packages use consistent, professional colors:

- **Blue** (`borderblue`): RGB(0, 118, 186) - Information, neutral highlights
- **Green** (`bordergreen`): RGB(46, 184, 92) - Success, recommendations, positive
- **Red** (`borderred`): RGB(220, 53, 69) - Warnings, risks, critical
- **Orange** (`borderorange`): RGB(255, 159, 67) - Caution, moderate warnings
- **Gray** (`bordergray`): RGB(108, 117, 125) - Neutral, background

## Best Practices

### When to Use Each Style:

1. **Simple Borders** (`simple-borders.sty`)
   - Quick inline callouts
   - Small boxes for notes
   - When you need minimal styling
   - Fast compilation required

2. **Section Borders** (`section-borders.sty`)
   - Multi-paragraph content
   - Important findings or conclusions
   - Recommendations sections
   - Risk assessments
   - Color-coded information

3. **Page Borders** (`page-borders.sty`)
   - Formal reports or certificates
   - Title pages only (don't use on all pages)
   - Special documents requiring page frames
   - **Note:** Use sparingly, can be distracting on all pages

### Color Guidelines:

- **Blue:** Default choice for most content
- **Green:** Positive information, recommendations, successes
- **Red:** Warnings, risks, critical issues only
- **Orange:** Moderate warnings, cautions
- **Gray:** Neutral content, background information

## Compilation Requirements

All packages require:
- `xcolor` package
- `mdframed` package (for section-borders.sty)
- `tikz` package (for page-borders.sty)
- Modern LaTeX distribution (TeX Live 2020+, MiKTeX 2.9+)

These are standard packages included in all major LaTeX distributions.

## Troubleshooting

### If borders don't appear:
1. Ensure you have `\usepackage{<package-name>}` in preamble
2. Check that required packages are installed
3. Verify syntax of border commands/environments

### If compilation fails:
1. Check LaTeX error log for specific error
2. Verify you're using correct command/environment names
3. Ensure no conflicting packages

### If colors look wrong:
1. Ensure `xcolor` package is loaded
2. Check PDF viewer color settings
3. Try a different PDF viewer

## Integration with GenLaTeX

GenLaTeX is the product (GenLaTeX codebase): a powerful AI-native-first LaTeX editor with chat, natural-language editing, and agents. Border styles are used in generated LaTeX templates.

These border styles are automatically available to the AI agent when users request borders. The AI will:

1. Detect when user asks for borders
2. Select appropriate border style based on context
3. Inject the package and commands automatically
4. Validate syntax before writing to files

## Testing

All border styles have been tested with:
- ✅ article document class
- ✅ report document class
- ✅ book document class
- ✅ beamer document class (limited support)
- ✅ Tectonic LaTeX compiler
- ✅ pdflatex compiler
- ✅ xelatex compiler

## Version History

- **2026-02-17:** Initial release
  - Created simple-borders.sty
  - Created section-borders.sty
  - Created page-borders.sty
  - All packages validated and tested

## Support

For issues or questions:
1. Check this README first
2. Review LaTeX error logs
3. Verify package installation
4. Test with minimal example

---

**Status:** ✅ Production Ready
**Last Updated:** February 17, 2026
**Validated:** All border styles tested and working
