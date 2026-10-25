#!/bin/bash
# vidy-pool পুনরাবৃত্ত প্রশিক্ষণ — প্রতি পাসে নতুন পাবলিক-তালিকা (নোড রোজ বদলায়), verified জমতে থাকে
cd /home/user/vidy-addon
for i in $(seq 1 40); do
  node /tmp/lists_http.js >/dev/null 2>&1 || true
  echo "=== pass $i $(date +%H:%M:%S) ===" >> /home/user/train_loop.log
  PCONC=100 SCONC=28 MSMAX=3500 node train_pool_big.js 900 /home/user/vidy-addon/pxhttp.json >> /home/user/train_loop.log 2>&1
  python3 -c "import json;print('verified',len(json.load(open('/home/user/vidy-addon/vidy_px_verified.json'))))" >> /home/user/train_loop.log
  sleep 30
done
