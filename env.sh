#!/bin/bash
# Environment setup for Record Ranch development on macOS
# Source this file to set up env variables and venv

# --- Environment Variables ---
export DATABASE_URL="postgresql://username:password@localhost:5432/recordranch"
export AWS_REGION="us-east-1"
export COGNITO_USER_POOL_ID="your_cognito_pool_id"
export COGNITO_CLIENT_ID="your_cognito_app_client_id"
export DISCOGS_TOKEN="your_discogs_api_token"
export SECRET_KEY="replace_with_random_secret_for_jwt_signing"

# Local dev server
export UVICORN_PORT=8000
export UVICORN_HOST=127.0.0.1

# --- Python venv setup ---
VENV_DIR="./venv"

# Detect Homebrew Python
if [ -x "/opt/homebrew/bin/python3" ]; then
    PYTHON_BIN="/opt/homebrew/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN=$(command -v python3)
else
    echo "ERROR: No python3 found. Install via Homebrew: brew install python"
    return 1
fi

echo "Using Python: $($PYTHON_BIN --version)"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in $VENV_DIR..."
    $PYTHON_BIN -m venv $VENV_DIR
    echo "Virtual environment created."
fi

# Activate venv
echo "Activating virtual environment..."
source $VENV_DIR/bin/activate

# Upgrade pip and install requirements if not already installed
if [ ! -f "$VENV_DIR/installed_requirements" ]; then
    echo "Installing required Python packages..."
    pip install --upgrade pip
    pip install -r requirements.txt
    touch "$VENV_DIR/installed_requirements"
    echo "Requirements installed."
fi

echo "Environment ready. Virtual environment active."
