#!/bin/bash

# Start the server in the background
npm start &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 3

# Run tests
npm test
TEST_EXIT=$?

# Kill the server
kill $SERVER_PID 2>/dev/null

exit $TEST_EXIT
