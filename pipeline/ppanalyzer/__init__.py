"""PP Analyzer data pipeline.

fetch  -> pull ranked players and their top plays from ScoreSaber / BeatLeader into a raw snapshot
build  -> aggregate a raw snapshot into the static JSON the web app reads
"""

USER_AGENT = "ppanalyzer/2.0 (+https://github.com/brianhuang822/ppanalyzer)"
