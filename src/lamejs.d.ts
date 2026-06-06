declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array, right: Int16Array): Uint8Array;
    flush(): Uint8Array;
  }
  const defaultExport: {
    Mp3Encoder: typeof Mp3Encoder;
  };
  export default defaultExport;
}

declare module 'lamejs/lame.min.js?raw' {
  const content: string;
  export default content;
}

declare module 'lamejs/lame.all.js?raw' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    lamejs?: {
      Mp3Encoder: typeof import('lamejs').Mp3Encoder;
    };
  }
}
