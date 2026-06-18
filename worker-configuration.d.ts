interface Workflow {
  create(options?: { params?: unknown; id?: string }): Promise<unknown>;
}
