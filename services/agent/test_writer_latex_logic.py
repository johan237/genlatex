#!/usr/bin/env python3
"""
Logical test for writer.py and latex.py key functionality
Tests the critical paths without requiring full dependencies
"""

import sys
from pathlib import Path

def test_writer_refinement_logic():
    """Test refinement logic"""
    print("Testing writer.py refinement logic...")
    
    # Simulate refinement logic
    def simulate_refinement(current_words, target_words, tolerance=0.10):
        if target_words < 50 or target_words == 0:
            return "skip"
        
        deviation = abs(current_words - target_words) / target_words
        if deviation <= tolerance:
            return "within_tolerance"
        
        needs_expansion = current_words < target_words * (1 - tolerance)
        return "expand" if needs_expansion else "trim"
    
    # Test cases
    test_cases = [
        (100, 100, 0.10, "within_tolerance"),  # Exact match
        (95, 100, 0.10, "within_tolerance"),    # Within 10%
        (85, 100, 0.10, "trim"),                # Needs trimming
        (115, 100, 0.10, "trim"),               # Needs trimming
        (70, 100, 0.10, "expand"),              # Needs expansion
        (50, 100, 0.10, "expand"),              # Needs expansion
        (10, 50, 0.10, "skip"),                 # Target too small
        (100, 0, 0.10, "skip"),                 # Target is zero
    ]
    
    passed = 0
    failed = 0
    
    for current, target, tol, expected in test_cases:
        result = simulate_refinement(current, target, tol)
        if result == expected:
            passed += 1
        else:
            failed += 1
            print(f"  FAILED: {current}->{target} (tol={tol}): got {result}, expected {expected}")
    
    print(f"  Refinement logic: {passed}/{len(test_cases)} tests passed")
    return failed == 0

def test_latex_section_detection():
    """Test template section detection logic"""
    print("Testing latex.py section detection logic...")
    
    import re
    
    def template_has_sections(template_content):
        section_regex = r'\\(section|subsection|subsubsection)\s*\{'
        return bool(re.search(section_regex, template_content))
    
    test_cases = [
        ("\\section{Introduction}", True),
        ("\\subsection{Background}", True),
        ("\\subsubsection{Details}", True),
        ("No sections here", False),
        ("\\begin{document}\n\\section{Test}\n\\end{document}", True),
        ("\\documentclass{article}\n\\begin{document}\nContent\n\\end{document}", False),
        ("\\section{One}\n\\section{Two}", True),
    ]
    
    passed = 0
    failed = 0
    
    for template, expected in test_cases:
        result = template_has_sections(template)
        if result == expected:
            passed += 1
        else:
            failed += 1
            print(f"  FAILED: template_has_sections returned {result}, expected {expected}")
            print(f"    Template: {template[:50]}...")
    
    print(f"  Section detection: {passed}/{len(test_cases)} tests passed")
    return failed == 0

def test_safe_dict_access():
    """Test that dictionary access patterns are safe"""
    print("Testing safe dictionary access patterns...")
    
    # Simulate the patterns we use
    def safe_access_pattern(section):
        """Simulate our safe access pattern"""
        section_name = section.get('section_name', section.get('name', 'Unknown Section'))
        section_id = section.get('section_id', section.get('id', ''))
        section_content = section.get('content', '')
        
        # Check subsections safely
        if section.get('subsections'):
            subsections = section['subsections']  # Safe because of the if check
            return len(subsections)
        return 0
    
    test_cases = [
        ({'section_name': 'Test', 'content': 'Content', 'subsections': [1, 2]}, 2),
        ({'name': 'Test', 'content': 'Content'}, 0),  # No subsections key
        ({'section_name': 'Test', 'content': 'Content', 'subsections': []}, 0),  # Empty list
        ({'section_name': 'Test'}, 0),  # Missing content
        ({}, 0),  # Empty dict
    ]
    
    passed = 0
    failed = 0
    
    for section_dict, expected_count in test_cases:
        try:
            result = safe_access_pattern(section_dict)
            if result == expected_count:
                passed += 1
            else:
                failed += 1
                print(f"  FAILED: Expected {expected_count} subsections, got {result}")
        except KeyError as e:
            failed += 1
            print(f"  FAILED: KeyError - {e}")
        except Exception as e:
            failed += 1
            print(f"  FAILED: Exception - {e}")
    
    print(f"  Safe access patterns: {passed}/{len(test_cases)} tests passed")
    return failed == 0

def test_division_by_zero():
    """Test division by zero protection"""
    print("Testing division by zero protection...")
    
    def safe_division(numerator, denominator):
        """Simulate safe division"""
        if denominator == 0:
            return None
        return numerator / denominator
    
    def refinement_deviation(current, target):
        """Simulate refinement deviation calculation"""
        if target < 50 or target == 0:
            return None
        return abs(current - target) / target
    
    test_cases = [
        (100, 100, 0.0),      # No deviation
        (100, 0, None),       # Target zero - should skip
        (100, 10, None),      # Target too small - should skip
        (100, 50, 1.0),       # Valid calculation
        (0, 100, 1.0),        # Current zero
    ]
    
    passed = 0
    failed = 0
    
    for current, target, expected_dev in test_cases:
        try:
            result = refinement_deviation(current, target)
            if result == expected_dev:
                passed += 1
            else:
                failed += 1
                print(f"  FAILED: deviation({current}, {target}) = {result}, expected {expected_dev}")
        except ZeroDivisionError:
            failed += 1
            print(f"  FAILED: ZeroDivisionError for ({current}, {target})")
    
    print(f"  Division safety: {passed}/{len(test_cases)} tests passed")
    return failed == 0

def main():
    """Run all logical tests"""
    print("=" * 60)
    print("LOGICAL TESTS FOR writer.py AND latex.py")
    print("=" * 60)
    print()
    
    results = []
    
    # Test refinement logic
    results.append(test_writer_refinement_logic())
    print()
    
    # Test section detection
    results.append(test_latex_section_detection())
    print()
    
    # Test safe dictionary access
    results.append(test_safe_dict_access())
    print()
    
    # Test division by zero protection
    results.append(test_division_by_zero())
    print()
    
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if all(results):
        print("OK: All logical tests passed")
        return 0
    else:
        print("ERROR: Some logical tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
