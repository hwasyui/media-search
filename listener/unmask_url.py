#!/usr/bin/env python3
"""
Unmask Google News URLs using googlenewsdecoder (teknik repo Bughopper14/corporate-keyword-crawler).
Mencoba decode token Google News secara langsung.
Bila gagal (misal 429 dari batchexecute), mengembalikan success: false.
"""

import sys
import json

def decode_url(url: str, timeout: float = 5.0) -> dict:
    try:
        from googlenewsdecoder import gnewsdecoder
        res = gnewsdecoder(url, timeout=timeout)
        if isinstance(res, dict) and res.get('success'):
            decoded = res.get('decoded_url')
            if decoded and not decoded.startswith('https://news.google.com'):
                return {"success": True, "decoded_url": decoded}
        return {"success": False, "message": res.get('message') if isinstance(res, dict) else 'decode_failed'}
    except Exception as e:
        return {"success": False, "message": str(e)}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        u = sys.argv[1]
        out = decode_url(u)
        print(json.dumps(out))
    else:
        print(json.dumps({"success": False, "message": "no_url_provided"}))

