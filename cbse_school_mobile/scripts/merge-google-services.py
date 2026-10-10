#!/usr/bin/env python3
"""Merge a Firebase per-app config (stdin, the getConfig API response) into
an existing google-services.json without touching the clients already there.

usage: ... | merge-google-services.py android/app/google-services.json <package>
"""
import base64
import json
import sys


def package_of(client):
    return client["client_info"]["android_client_info"]["package_name"]


def main():
    cfg_path, pkg = sys.argv[1], sys.argv[2]
    resp = json.load(sys.stdin)
    if "error" in resp:
        sys.exit("config fetch failed: " + json.dumps(resp["error"]))
    new = json.loads(base64.b64decode(resp["configFileContents"]))
    with open(cfg_path) as f:
        cur = json.load(f)

    if new["project_info"]["project_id"] != cur["project_info"]["project_id"]:
        sys.exit(
            "refusing to merge: config is for project %s, file is for %s"
            % (new["project_info"]["project_id"], cur["project_info"]["project_id"])
        )

    have = {package_of(c) for c in cur["client"]}
    added = [c for c in new["client"] if package_of(c) not in have]
    if pkg not in have and pkg not in {package_of(c) for c in added}:
        sys.exit("fetched config has no client for %s" % pkg)

    if not added:
        print("google-services.json already has a client for %s; unchanged" % pkg)
        return

    cur["client"].extend(added)
    with open(cfg_path, "w") as f:
        json.dump(cur, f, indent=2)
        f.write("\n")
    print("added %d client(s) to %s: %s" % (len(added), cfg_path, ", ".join(package_of(c) for c in added)))
    print("clients now: " + ", ".join(package_of(c) for c in cur["client"]))


if __name__ == "__main__":
    main()
