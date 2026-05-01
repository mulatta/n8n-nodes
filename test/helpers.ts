import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
} from "n8n-workflow";

/**
 * Create a minimal mock of IExecuteFunctions for node-level tests.
 *
 * @param params - Map of node parameter name to value.
 * @param credentials - Optional map of credential type to credential data.
 * @param opts - Additional execution overrides.
 */
export function createMockExecuteFunctions(
  params: Record<string, unknown>,
  credentials?: Record<string, IDataObject>,
  opts?: {
    continueOnFail?: boolean;
    inputItems?: INodeExecutionData[];
    helpers?: Record<string, unknown>;
  },
): IExecuteFunctions {
  return {
    getInputData: () =>
      opts?.inputItems ?? ([{ json: {} }] as INodeExecutionData[]),
    getNodeParameter: (name: string) => params[name],
    getCredentials: (type: string) =>
      Promise.resolve(credentials?.[type] ?? {}),
    getNode: () => ({ name: "TestNode", typeVersion: 1, type: "test" }),
    continueOnFail: () => opts?.continueOnFail ?? false,
    helpers: {
      returnJsonArray: (data: IDataObject | IDataObject[]) =>
        (Array.isArray(data) ? data : [data]).map((d) => ({ json: d })),
      constructExecutionMetaData: (inputData: INodeExecutionData[]) =>
        inputData,
      ...opts?.helpers,
    },
  } as unknown as IExecuteFunctions;
}
