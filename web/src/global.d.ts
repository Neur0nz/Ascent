interface Window {
  loadPyodide?: (options: { indexURL?: string; fullStdLib?: boolean }) => Promise<any>;
  ort?: any;
}

declare module '*.py?url' {
  const src: string;
  export default src;
}

declare module '*.py?raw' {
  const content: string;
  export default content;
}

declare module '*.onnx?url' {
  const src: string;
  export default src;
}
