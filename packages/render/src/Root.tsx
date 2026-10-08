import { Composition, registerRoot } from "remotion";
import { Explainer } from "./Explainer.js";
import { COMPOSITION_ID, ExplainerProps, FPS, HEIGHT, WIDTH, totalFrames } from "./props.js";
import { sampleProps } from "./sample.js";

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Explainer}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={totalFrames(sampleProps)}
      defaultProps={sampleProps}
      schema={ExplainerProps}
      calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props) })}
    />
  );
}

registerRoot(RemotionRoot);
