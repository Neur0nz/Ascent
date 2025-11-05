#!/bin/bash

# Deploy Supabase Edge Functions Script
# This script deploys both create-match and submit-move Edge Functions

set -e  # Exit on any error

echo "🚀 Deploying Supabase Edge Functions..."

# Check if we're in the right directory
if [ ! -f "supabase/config.toml" ]; then
    echo "❌ Error: supabase/config.toml not found. Please run this script from the project root."
    exit 1
fi

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js."
    exit 1
fi

echo "📦 Deploying create-match function..."
npx supabase functions deploy create-match

echo "📦 Deploying submit-move function..."
npx supabase functions deploy submit-move

echo "✅ All Edge Functions deployed successfully!"
echo ""
echo "🔗 Your functions are now available at:"
echo "   - https://wiydzsheqwfttgevkmdm.supabase.co/functions/v1/create-match"
echo "   - https://wiydzsheqwfttgevkmdm.supabase.co/functions/v1/submit-move"
echo ""
echo "📋 To check function status, run:"
echo "   npx supabase functions list"
echo ""
echo "📊 To view function logs, run:"
echo "   npx supabase functions logs create-match"
echo "   npx supabase functions logs submit-move"
