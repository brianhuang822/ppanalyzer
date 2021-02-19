import pickle
from os import path
import math
import json

players = []
for i in range(0, 30000):
    cur_path = f"pickles/{str(i)}.p"
    if path.exists(cur_path):
        players.append(pickle.load(open(cur_path, 'rb')))

interval = 100
ranks = {}
for x in range(0, 30000, interval):
    counts_logged = {}
    for songs in players[x:x + interval]:
        for i in range(len(songs)):
            song = songs[i]
            if song not in counts_logged:
                counts_logged[song] = 0.0
            counts_logged[song] += math.pow(0.965, i)
    top = [(k, v) for k, v in sorted(counts_logged.items(), key=lambda x: x[1], reverse=True)][:50]
    ranks[x] = top
json.dump(ranks, open('ranks.json', "w+"))
