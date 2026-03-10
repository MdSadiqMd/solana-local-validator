#!/bin/bash

echo "Starting Mini Solana Validator..."
npm start &
SERVER_PID=$!

# Wait for server to start
sleep 3

echo ""
echo "========================================="
echo "Running Test Suite"
echo "========================================="
echo ""

# Run all tests
echo "1. Basic RPC Tests..."
npx tsx simple-test.ts
if [ $? -ne 0 ]; then
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo ""
echo "2. SPL Token Tests..."
npx tsx token-test.ts
if [ $? -ne 0 ]; then
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo ""
echo "3. Edge Case Tests..."
npx tsx edge-case-test.ts
if [ $? -ne 0 ]; then
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo ""
echo "4. Comprehensive Tests..."
npx tsx comprehensive-test.ts
if [ $? -ne 0 ]; then
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo ""
echo "========================================="
echo "✓ ALL TESTS PASSED!"
echo "========================================="

# Kill the server
kill $SERVER_PID 2>/dev/null

exit 0
