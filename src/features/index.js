import { ImageUpload as WfArtImageUpload } from "./imageUpload/index.js";
import { Operation as WfArtOperation, MuteButton as WfArtMuteButton } from "./operation/index.js";
import {
    OptionalParams as WfArtOptionalParams,
    Parameter as WfArtParameter,
    PromptSection as WfArtPromptSection,
} from "./params/index.js";
import { Results as WfArtResults } from "./results/index.js";

const featureExports = Object.freeze({
    ImageUpload: WfArtImageUpload,
    MuteButton: WfArtMuteButton,
    Operation: WfArtOperation,
    OptionalParams: WfArtOptionalParams,
    Parameter: WfArtParameter,
    PromptSection: WfArtPromptSection,
    Results: WfArtResults,
});

export const {
    ImageUpload,
    MuteButton,
    Operation,
    OptionalParams,
    Parameter,
    PromptSection,
    Results,
} = featureExports;
