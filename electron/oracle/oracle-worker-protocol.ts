import type { OracleResult } from "../../shared/contracts";

export type OracleWorkerRequest =
  | {
      type: "analyze";
      jobId: string;
      filePath: string;
    }
  | {
      type: "cancel";
      jobId: string;
    };

export type OracleWorkerResponse =
  | {
      type: "result";
      jobId: string;
      result: OracleResult;
    }
  | {
      type: "error";
      jobId: string;
      message: string;
      stack?: string;
    };
