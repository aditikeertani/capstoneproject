import { getFloorplanImage } from "../api";

export default function FloorplanDesigner() {
  

  var startX;
  var startY;

  const beginSelection = (event) => {
    console.log(event);
    var rect = event.target.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    console.log(startX + ", " + startY);
  }
  
  const endSelection = (event) => {
    console.log(event);
  }

  const updateSelection = (event) => {
    //console.log(event);
  }

  componentDidMount () {
    console.log("test");
  }

  getFloorplanImage().then(
    (floorplanData) => {
      return (
          <div>
            <canvas id="c"
              width={floorplanData["width"]}
              height={floorplanData["height"]}
              onMouseDown={beginSelection}
              onMouseUp={endSelection}
              onMouseMove={updateSelection}/>
              
          </div>
        );
    }
  )

}
