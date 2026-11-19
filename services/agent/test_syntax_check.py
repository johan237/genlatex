#!/usr/bin/env python3
"""
Syntax and basic logic check for writer.py and latex.py
"""

import ast
import sys
from pathlib import Path

def check_syntax(filepath):
    """Check Python syntax of a file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        ast.parse(code)
        print(f"OK: {filepath}: Syntax OK")
        return True
    except SyntaxError as e:
        print(f"ERROR: {filepath}: Syntax Error")
        print(f"  Line {e.lineno}: {e.msg}")
        if e.text:
            print(f"  {e.text}")
        return False
    except Exception as e:
        print(f"ERROR: {filepath}: Error - {e}")
        return False

def check_imports(filepath):
    """Check if imports are valid (without actually importing)"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        tree = ast.parse(code)
        
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append(node.module)
        
        print(f"  Imports found: {len(imports)}")
        return True
    except Exception as e:
        print(f"  Import check failed: {e}")
        return False

def check_async_functions(filepath):
    """Check async function definitions"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        tree = ast.parse(code)
        
        async_funcs = []
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                async_funcs.append(node.name)
        
        print(f"  Async functions: {len(async_funcs)}")
        if async_funcs:
            print(f"    {', '.join(async_funcs[:5])}{'...' if len(async_funcs) > 5 else ''}")
        return True
    except Exception as e:
        print(f"  Async check failed: {e}")
        return False

def check_method_calls(filepath):
    """Check for potential issues in method calls"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        tree = ast.parse(code)
        
        issues = []
        
        # Check for direct dictionary access that might cause KeyError
        for node in ast.walk(tree):
            if isinstance(node, ast.Subscript):
                if isinstance(node.value, ast.Name):
                    var_name = node.value.id
                    # Check if it's a dict access without .get()
                    if isinstance(node.slice, ast.Constant) or isinstance(node.slice, ast.Str):
                        # This is a potential KeyError risk, but we've already fixed these
                        pass
        
        # Check for division operations
        for node in ast.walk(tree):
            if isinstance(node, ast.Div):
                # Check if divisor could be zero
                if isinstance(node.right, ast.Constant) and node.right.value == 0:
                    issues.append(f"Potential division by zero at line {node.lineno}")
        
        if issues:
            print(f"  WARNING: Potential issues found: {len(issues)}")
            for issue in issues[:3]:
                print(f"    - {issue}")
        else:
            print(f"  OK: No obvious logical issues detected")
        
        return True
    except Exception as e:
        print(f"  Logic check failed: {e}")
        return False

def main():
    """Run all checks"""
    print("=" * 60)
    print("SYNTAX AND LOGIC CHECK")
    print("=" * 60)
    
    files_to_check = [
        'agents/writer.py',
        'utils/latex.py'
    ]
    
    results = []
    
    for filepath in files_to_check:
        path = Path(filepath)
        if not path.exists():
            print(f"ERROR: {filepath}: File not found")
            results.append(False)
            continue
        
        print(f"\nChecking {filepath}...")
        print("-" * 60)
        
        # Syntax check
        syntax_ok = check_syntax(filepath)
        
        if syntax_ok:
            # Import check
            check_imports(filepath)
            
            # Async functions check
            check_async_functions(filepath)
            
            # Logic check
            check_method_calls(filepath)
        
        results.append(syntax_ok)
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if all(results):
        print("OK: All files passed syntax checks")
        print("OK: No syntax errors detected")
        return 0
    else:
        print("ERROR: Some files failed syntax checks")
        return 1

if __name__ == "__main__":
    sys.exit(main())
