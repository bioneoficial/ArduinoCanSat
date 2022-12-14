import { useState } from "react";
interface SerialPort {
  close(): Promise<void>;
}
let port: SerialPort | null = null;
let readingTask: Promise<void> | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let outputStream: WritableStream<string> | null = null;
let writingTask: Promise<void> | null = null;

interface UseArduinoOptions {
  /**
   * Callback function invoked when data is read from the serial.
   *
   * @param value   The value that was read.
   */
  onRead?(value: string): void;

  /**
   * Optional delimeter for incoming serial data that triggers the `onRead()`
   * callback. This defaults to no delimeter, which triggers the callback as
   * soon as new read data is available. Note that the delimiter is not returned
   * with the read data.
   */
  readDelimiter?: string;
}

type ArduinoStatus = "connected" | "disconnected";

type UseArduinoResult = {
  connect: (baudRate: number) => Promise<void>;

  disconnect: () => Promise<void>;

  write: (output: string) => Promise<void>;

  status: ArduinoStatus;
};

export function useArduino({
  onRead,
  readDelimiter = "",
}: UseArduinoOptions): UseArduinoResult {
  const [status, setStatus] = useState<ArduinoStatus>("disconnected");

  // Reads data from the input stream
  const readLoop = async (): Promise<void> => {
    if (!reader || !onRead) return;

    let readData = "";
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        if (readDelimiter === "") {
          // Call `onRead()` immediately if not delimiter was provided
          onRead(value);
        } else {
          // Split out the new read value based on the delimeter
          const parsedStrings = value.split(readDelimiter);
          if (parsedStrings.length === 1) {
            // Append the new read data if the delimiter was not found
            readData += value;
          } else {
            // Call `onRead()` with the appended data from the first split
            onRead(readData + parsedStrings.shift());

            // Set readData to the last element
            if (parsedStrings.length > 0) {
              readData = parsedStrings.pop() || "";
            }

            // Call `onRead()` callback on remaining string tokens
            parsedStrings.forEach((parsedValue) => {
              onRead(parsedValue);
            });
          }
        }
      }

      if (done) {
        reader.releaseLock();
        break;
      }
    }
  };

  const write = async (output: string): Promise<void> => {
    if (!outputStream) return;

    const writer = outputStream.getWriter();
    await writer.write(output);
    writer.releaseLock();
  };

  const connect = async (baudRate: number): Promise<void> => {
    if (!navigator.serial || status === "connected" || port) return;

    port = await navigator.serial.requestPort();
    await port.open({ baudRate });

    // Set up input stream to read data from the serial line. Only do this if
    // an onRead() callback function was provided to pass the read data on to.
    if (onRead) {
      const decoder = new TextDecoderStream();
      readingTask = port.readable.pipeTo(decoder.writable);

      const inputStream = decoder.readable;
      reader = inputStream.getReader();
      readLoop();
    }

    // Set up output stream to write data to the serial line
    const encoder = new TextEncoderStream();
    writingTask = encoder.readable.pipeTo(port.writable);
    outputStream = encoder.writable;

    setStatus("connected");
  };

  const disconnect = async (): Promise<void> => {
    if (status === "disconnected" || !port) return;

    if (reader && readingTask) {
      await reader.cancel();
      await readingTask.catch((error) =>
        console.log("Error while disconnecting", error)
      );

      reader = null;
      readingTask = null;
    }

    if (outputStream && writingTask) {
      await outputStream.getWriter().close();
      await writingTask;

      outputStream = null;
      writingTask = null;
    }

    await port.close();
    port = null;

    setStatus("disconnected");
  };

  return {
    status,
    connect,
    disconnect,
    write,
  };
}
