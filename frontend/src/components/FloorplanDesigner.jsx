export default function StreamAssignment() {

  const beginSelection = (event) => {
    console.log(event);
  }
  
  const endSelection = (event) => {
    console.log(event);
  }

  const updateSelection = (event) => {
    //console.log(event);
  }

  return (
    <div>
      <canvas id="c" 
        onMouseDown={beginSelection}
        onMouseUp={endSelection}
        onmouseMove={updateSelection}/>
    </div>
  );
}
