import pickle
from bs4 import BeautifulSoup
import requests
from os import path
import time

url = "https://scoresaber.com"
links = pickle.load(open('player_urls.p', 'rb'))
try:
    for i in range(len(links)):
        link = links[i]
        cur_path = f"pickles/{str(i)}.p"
        print(i)
        if not path.exists(cur_path):
            r = requests.get(f"{url}{str(link)}")
            soup = BeautifulSoup(r.content, "html.parser")
            songs = [song.text for song in soup.find_all('span', attrs={'class': 'songTop pp'})]
            if len(songs) < 2:
                print("ERROR!" + str(songs))
                print(soup.prettify())
                print(r.status_code)
                print(r.url)
            else:
                pickle.dump(songs, open(cur_path, "wb"))
except:
    time.sleep(10)
