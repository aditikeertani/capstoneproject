import { useEffect } from "react";
import { getFloorplanImage } from "../api";

export default function FloorplanDesigner() {
  
  var floorplanData;

  var startX;
  var startY;
  var endX;
  var endY;

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
  /*
  const loadImage = (event)  => {
    useEffect(() => {
      c = event.target;
      ctx = c.getContext("2d");
      ctx.drawImage(floorplanData["imagedata"], 0, 0);
    }, []);
  }*/

  getFloorplanImage().then(
    (floorplanData) => {
      return (
          <div>
            <input type="button" onClick={loadImage}></input>
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
