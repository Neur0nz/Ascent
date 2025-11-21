import subprocess
import re
import sys

def run_command(cmd):
    print(f"Running: {cmd}")
    # supabase commands output to stderr often, or stdout. We capture both.
    result = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.stdout + result.stderr, result.returncode

def main():
    print("Attempting to fix migration history...")
    
    # 1. Run db pull to get the list of mismatching migrations
    output, code = run_command("npx supabase db pull")
    
    if code == 0:
        print("db pull successful! No repairs needed.")
    else:
        print("db pull failed. Analyzing output for repair instructions...")
        
        # Regex to find repair commands suggested by supabase CLI
        # Example line: supabase migration repair --status reverted 20251026235526
        repair_cmds = re.findall(r'(supabase migration repair --status reverted \d+)', output)
        
        if not repair_cmds:
            print("No specific repair instructions found in output.")
            print("Output was:")
            print(output)
            # We might try pushing anyway if it was a different error, but risky.
            # But we want to push the NEW migration.
        else:
            print(f"Found {len(repair_cmds)} migrations to revert in history.")
            for cmd in repair_cmds:
                # We need to run it with npx prefix
                full_cmd = "npx " + cmd
                out, c = run_command(full_cmd)
                if c != 0:
                    print(f"Failed to repair: {cmd}")
                    print(out)
            
            print("Repairs completed.")

    # 2. Now try to push
    print("Attempting db push...")
    output, code = run_command("npx supabase db push")
    print(output)
    if code != 0:
        print("db push failed.")
        sys.exit(1)
    else:
        print("db push successful!")

if __name__ == "__main__":
    main()
