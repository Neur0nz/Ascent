declare module '*?worker&module' {
  const WorkerConstructor: { new (options?: WorkerOptions): Worker };
  export default WorkerConstructor;
}

declare module '*?worker' {
  const WorkerConstructor: { new (options?: WorkerOptions): Worker };
  export default WorkerConstructor;
}
