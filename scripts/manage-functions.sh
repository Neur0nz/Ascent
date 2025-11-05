#!/bin/bash

# Supabase Edge Functions Management Script
# This script provides various operations for managing Edge Functions

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if we're in the right directory
check_directory() {
    if [ ! -f "supabase/config.toml" ]; then
        print_error "supabase/config.toml not found. Please run this script from the project root."
        exit 1
    fi
}

# Check if npx is available
check_npx() {
    if ! command -v npx &> /dev/null; then
        print_error "npx not found. Please install Node.js."
        exit 1
    fi
}

# Deploy all functions
deploy_functions() {
    print_info "Deploying Supabase Edge Functions..."
    
    print_info "Deploying create-match function..."
    npx supabase functions deploy create-match
    
    print_info "Deploying submit-move function..."
    npx supabase functions deploy submit-move
    
    print_status "All Edge Functions deployed successfully!"
}

# List functions
list_functions() {
    print_info "Listing Edge Functions..."
    npx supabase functions list
}

# Show function logs
show_logs() {
    local function_name=${1:-"create-match"}
    print_info "Showing logs for $function_name..."
    npx supabase functions logs "$function_name"
}

# Show function details
show_function() {
    local function_name=${1:-"create-match"}
    print_info "Showing details for $function_name..."
    npx supabase functions logs "$function_name" --limit 10
}

# Test function endpoints
test_functions() {
    print_info "Testing Edge Function endpoints..."
    
    local project_url="https://wiydzsheqwfttgevkmdm.supabase.co"
    
    echo ""
    print_info "Testing create-match endpoint (OPTIONS request)..."
    curl -X OPTIONS "$project_url/functions/v1/create-match" \
         -H "Content-Type: application/json" \
         -w "\nHTTP Status: %{http_code}\n" \
         -s || print_warning "OPTIONS request failed"
    
    echo ""
    print_info "Testing submit-move endpoint (OPTIONS request)..."
    curl -X OPTIONS "$project_url/functions/v1/submit-move" \
         -H "Content-Type: application/json" \
         -w "\nHTTP Status: %{http_code}\n" \
         -s || print_warning "OPTIONS request failed"
}

# Show help
show_help() {
    echo "Supabase Edge Functions Management Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  deploy              Deploy all Edge Functions"
    echo "  list                List all deployed functions"
    echo "  logs [function]     Show logs for a function (default: create-match)"
    echo "  test                Test function endpoints"
    echo "  help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 deploy                    # Deploy all functions"
    echo "  $0 logs create-match         # Show create-match logs"
    echo "  $0 logs submit-move          # Show submit-move logs"
    echo "  $0 test                      # Test all endpoints"
    echo ""
    echo "Function URLs:"
    echo "  - https://wiydzsheqwfttgevkmdm.supabase.co/functions/v1/create-match"
    echo "  - https://wiydzsheqwfttgevkmdm.supabase.co/functions/v1/submit-move"
}

# Main script logic
main() {
    check_directory
    check_npx
    
    case "${1:-deploy}" in
        "deploy")
            deploy_functions
            ;;
        "list")
            list_functions
            ;;
        "logs")
            show_logs "$2"
            ;;
        "test")
            test_functions
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
