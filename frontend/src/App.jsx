import { useState } from 'react'
import './App.css'
import SingleRoom from './SingleRoom'

const API_BASE = import.meta.env.VITE_API_BASE

function App() {
  const [count, setCount] = useState(0)

  const clickEvent = async () => {
    const response = await fetch(`https://${API_BASE}/process`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',  // ← Add this header
      },
    })

    const data = await response.json();
    const number = parseInt(data.message);
    const msg = `${number}${Math.floor(number / 10) !== 1 ? (number % 10 === 1 ? 'st' : (number % 10 === 2 ? 'nd' : (number % 10 === 3 ? 'rd' : 'th'))) : 'th'} messsge`;

    const response2 = await fetch(`https://${API_BASE}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',  // ← Add this header
      },
      body: JSON.stringify({ message: msg }),
    })

    console.log(await response2.text());

    setCount(data.message)
  }

  return (
    <>
      <div className="card">
        <button onClick={clickEvent}>
          count is {count}
        </button>
      </div>
      <div>
        <SingleRoom />
      </div>
    </>
  )
}

export default App
