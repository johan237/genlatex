# GenLaTeX Agent Test Suite

Comprehensive enterprise-grade test suite for the GenLaTeX Agent system.

## Test Structure

```
tests/
├── unit/                 # Unit tests for individual components
├── integration/          # Integration tests for system components
├── api/                  # API endpoint tests
├── performance/          # Performance and load tests
├── fixtures/             # Test data and fixtures
├── utils/                # Test utilities and helpers
├── conftest.py          # Pytest configuration and fixtures
├── pytest.ini          # Pytest settings
├── requirements.txt     # Test dependencies
└── run_tests.py         # Test runner script
```

## Running Tests

### Quick Start
```bash
# Run all tests
python tests/run_tests.py

# Run specific test types
python tests/run_tests.py --type unit
python tests/run_tests.py --type integration
python tests/run_tests.py --type api
python tests/run_tests.py --type performance

# Run with verbose output
python tests/run_tests.py --verbose

# Run without coverage
python tests/run_tests.py --no-coverage
```

### Using pytest directly
```bash
# Install test dependencies
pip install -r tests/requirements.txt

# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=. --cov-report=html

# Run specific test file
pytest tests/unit/test_memory_core.py

# Run tests with markers
pytest -m unit
pytest -m integration
pytest -m api
pytest -m performance
```

## Test Categories

### Unit Tests (`tests/unit/`)
- **test_memory_core.py**: Memory manager functionality
- **test_memory_components.py**: Individual memory components
- **test_latex_generator.py**: LaTeX generation functionality

### Integration Tests (`tests/integration/`)
- **test_memory_integration.py**: Memory system integration
- Cross-component functionality
- End-to-end workflows

### API Tests (`tests/api/`)
- **test_memory_endpoints.py**: Memory API endpoints
- Request/response validation
- Error handling
- Authentication and authorization

### Performance Tests (`tests/performance/`)
- **test_memory_performance.py**: Memory system performance
- Load testing
- Scalability testing
- Resource usage monitoring

## Test Configuration

### Pytest Configuration (`pytest.ini`)
- Test discovery patterns
- Coverage settings
- Markers and filters
- Output formatting

### Fixtures (`conftest.py`)
- Test data generators
- Memory manager instances
- API clients
- Mock configurations

## Test Data

### Sample Data (`fixtures/sample_data.py`)
- Paper data samples
- Memory episode samples
- File content samples
- Image data samples
- API request samples

### Test Utilities (`utils/test_helpers.py`)
- Data generators
- Assertion helpers
- Performance utilities
- Cleanup functions

## Coverage Requirements

- **Minimum coverage**: 80%
- **Coverage reports**: HTML and terminal
- **Coverage exclusions**: Test files, configuration files

## Test Markers

- `@pytest.mark.unit`: Unit tests
- `@pytest.mark.integration`: Integration tests
- `@pytest.mark.api`: API tests
- `@pytest.mark.performance`: Performance tests
- `@pytest.mark.slow`: Slow running tests
- `@pytest.mark.memory`: Memory system tests
- `@pytest.mark.latex`: LaTeX generation tests
- `@pytest.mark.file_upload`: File upload tests
- `@pytest.mark.image`: Image management tests

## Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r tests/requirements.txt
      - name: Run tests
        run: python tests/run_tests.py --type all
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Best Practices

### Writing Tests
1. Use descriptive test names
2. Follow AAA pattern (Arrange, Act, Assert)
3. Use fixtures for common setup
4. Test both success and failure cases
5. Mock external dependencies
6. Keep tests independent and isolated

### Test Data
1. Use realistic test data
2. Create reusable fixtures
3. Clean up after tests
4. Use factories for complex objects
5. Validate test data structure

### Performance Testing
1. Set reasonable timeouts
2. Test with various data sizes
3. Monitor resource usage
4. Test concurrent operations
5. Benchmark critical paths

## Troubleshooting

### Common Issues
1. **Import errors**: Check PYTHONPATH and sys.path
2. **Fixture errors**: Verify fixture scope and dependencies
3. **Coverage issues**: Check coverage configuration
4. **Performance failures**: Adjust timeout values
5. **Resource cleanup**: Ensure proper teardown

### Debug Mode
```bash
# Run with debug output
pytest tests/ -v -s --tb=long

# Run single test with debug
pytest tests/unit/test_memory_core.py::TestMemoryManager::test_acquire_info -v -s
```

## Contributing

When adding new tests:
1. Follow existing patterns
2. Add appropriate markers
3. Update documentation
4. Ensure coverage requirements
5. Test on multiple Python versions
