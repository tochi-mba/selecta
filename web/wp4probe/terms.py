import collections
import json
import re

d = json.load(open('wp4probe/sweep.json', encoding='utf-8'))
TERMS = {
 'ready': r'\bready\b|\bnot ready\b',
 'analysed': r'\banaly[sz]\w*',
 'proposed': r'\bpropos\w*',
 'queued': r'\bqueue\w*|\bin line\b|\brender line\b',
 'saved': r'\bsav(e|ed|ing)\b',
 'playing': r'\bplaying\b|\bnow playing\b',
 'brand': r'\bSelecta\b(?!DJ)',
}
hits = collections.defaultdict(lambda: collections.defaultdict(set))
for route, v in d['routes'].items():
    lines = [
        line.strip() for line in v['text'].split('\n') if line.strip()
    ] + [attribute.strip() for attribute in v['attrs']]
    for line in lines:
        for term, rx in TERMS.items():
            if re.search(rx, line, re.I):
                hits[term][line[:160]].add(route)
for term in TERMS:
    print(f'=== {term} ({len(hits[term])} distinct strings)')
    for line, routes in sorted(hits[term].items()):
        print(f'  [{",".join(sorted(routes))}] {line}')
