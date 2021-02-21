import { useState, useEffect } from 'react';
import ranks from './ranks.json';
function App() {
  const [list, setList] = useState([]);
  const [value, setValue] = useState(1);
  useEffect(() => {
      let toSet = ranks[Math.min(Math.max(0, value - value % 100), 29900)];
      if (toSet){
        setList(toSet);
      }
  }, [value]);
  return (
    <div style={{marginLeft: '10%', marginRight: '10%'}}>
      <h1>PP Analyzer</h1>
      <div>Enter your current rank found <a href="https://scoresaber.com/global" target="_blank">here</a>. Song recommendations will pop up that others around your rank has found to increase their PP level</div>
      <br />
      Enter your rank: {' '}
      <input onChange={event => setValue(event.target.value)} value={value}></input>
      <br />
      <div>For rank {value} try these songs at level, find them <a href="https://www.beatsavior.io/#/ranked" target="_blank">here</a>:</div>
      <ol>
        {list.map((item) => <li key={item}>{item[0]}</li>)}
      </ol>
    </div>
  );
}

export default App;
