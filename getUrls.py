from bs4 import BeautifulSoup
import requests
import pickle

players_url = []
url = "https://scoresaber.com"
for page in range(1, 650):
    print(page)
    print(len(players_url))
    r = requests.get(f"{url}/global/{str(page)}")
    soup = BeautifulSoup(r.content, "html.parser")
    players = soup.find_all('td', attrs={'class': 'player'})
    for i in range(len(players)):
        players_url.append(players[i].find('a')['href'])
pickle.dump(players_url, open("player_urls.p", "wb"))
