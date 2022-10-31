import React, { ReactElement, useState, useRef } from "react";
import Card from "react-bootstrap/Card";
import Container from "react-bootstrap/Container";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Button from "react-bootstrap/Button";
import InputGroup from "react-bootstrap/InputGroup";
import Table from "react-bootstrap/Table";
import { exec } from "apexcharts";
import Chart from "react-apexcharts";
import { useThrottleFn } from "ahooks";
import { useArduino } from "../src/hooks/useArduino";
import * as Styles from './App.styles';

//const Chart = React.lazy(() => import("react-apexcharts"), { ssr: false });

type DataSeries = { name?: string; data: { x: number; y: number }[] }[];
type DataStats = { name: string; mean: number; stdev: number }[];

declare global {
  interface Window {
    ApexCharts: {
      exec: typeof exec;
    };
  }
}

/**
 * Interval at which the chart is updated. Note that data received within this
 * interval is still captured and stored, but not plotted on the chart.
 */
const CHART_UPDATE_INTERVAL = 250;

/**
 * The number of samples that are visible on the chart at any given time.
 * Samples that fall outside of this window are still plotted, but are
 * offscreen.
 */
const WINDOW_SIZE = 100;

const CHART_OPTIONS = {
  chart: {
    id: "line-chart",
    type: "line",
    width: 600,
    height: 350,
    offsetX: 10,
    animations: {
      enabled: true,
      speed: CHART_UPDATE_INTERVAL,
      easing: "linear",
      dynamicAnimation: {
        speed: CHART_UPDATE_INTERVAL,
      },
    },
    toolbar: {
      show: true,
      tools: {
        download: false,
      },
    },
  },
  legend: {
    show: true,
    position: "top",
    showForSingleSeries: false,
    floating: true,
  },
  dataLabels: { enabled: false },
  stroke: {
    curve: "straight",
    width: 2.5,
  },
  title: {
    align: "center",
  },
  markers: { size: 0 },
  grid: { show: false },
  yaxis: {
    title: {
      text: "Value",
      style: {
        color: "#444",
        cssClass: {fontWeight: "500",
          fontSize: "1.2rem",}},
    },
    axisBorder: {
      show: true,
      color: "#ccc",
      offsetX: 0,
      offsetY: 0,
      width: 0.75,
    },
  },
  xaxis: {
    type: "numeric",
    title: {
      text: "Sample",
      offsetY: 10,
      style: {
        color: "#444",
        cssClass: {fontWeight: "500",
        fontSize: "1.2rem",},
      },
    },
    tickAmount: 10,
    axisBorder: {
      show: true,
      color: "#ccc",
      offsetX: 0,
      offsetY: 0,
      height: 0.75,
    },
    min: 0,
    max: 10,
  },
};

const Index = (): ReactElement => {
  const serialData = useRef<string[]>([]);

  /** The current chart data. */
  const chartDataRef = useRef<DataSeries>([]);
  const chartData = chartDataRef.current;

  /**
   * Stores the current collection of series for the plot. A new series is
   * created for each unique variable name that is received from the serial
   * data. A unique index is stored in this map for each series so that data
   * index order for the chart is maintained even when data for a particular
   * variable is only provided intermitently.
   */
  const series = useRef<Map<string, number>>(new Map()).current;

  /** Stores a set of statistics generated for the current data set. */
  const [statistics, setStatistics] = useState<DataStats>([]);

  const { run: updateChartData } = useThrottleFn(
    (jsonString: string, index: number): void => {
      try {
        const data = JSON.parse(jsonString);

        Object.keys(data).forEach((key) => {
          if (!series.has(key)) {
            series.set(key, series.size);
            window.ApexCharts.exec("line-chart", "appendSeries", {
              name: key,
              data: [],
            });

            chartData.push({
              name: key,
              data: [],
            });
          }

          const seriesIndex = series.get(key);
          if (seriesIndex !== undefined) {
            chartData[seriesIndex].data.push({ x: index, y: data[key] });
          }
        });

        window.ApexCharts.exec("line-chart", "updateOptions", {
          xaxis: {
            min: Math.max(0, index - WINDOW_SIZE),
            max: index,
          },
          series: chartData,
        });
      } catch (error) {
        console.log("Error parsing data:", error);
      }
    },
    { wait: CHART_UPDATE_INTERVAL }
  );

  const { connect, disconnect, status } = useArduino({
    readDelimiter: "\n",
    onRead: (value) => {
      serialData.current.push(value);
      updateChartData(value, serialData.current.length - 1);
    },
  });

  const handleConnect = async (): Promise<void> => {
    if (status === "connected") return;

    await connect(9600);

    // Clear the current data if there is any
    if (serialData.current.length > 0) {
      handleClear();
    }

    window.ApexCharts.exec("line-chart", "updateOptions", {
      chart: {
        animations: { enabled: true },
      },
    });
  };

  const handleDisconnect = (): void => {
    if (status === "disconnected") return;
    disconnect();

    // Update chart data to include the full high resolution data set received
    // from the arduino, since real-time chart updates and data parsing are
    // throttled.
    const highResData: DataSeries = [];
    const entries = Array.from(series.entries()).sort(
      (e1, e2) => e1[1] - e2[1]
    );
    entries.forEach((entry) => {
      highResData.push({
        name: entry[0],
        data: [],
      });
    });

    serialData.current.forEach((jsonValue, dataIndex) => {
      try {
        const dataObject = JSON.parse(jsonValue);
        entries.forEach(([seriesKey, seriesIndex]) => {
          if (typeof dataObject[seriesKey] !== "undefined") {
            highResData[seriesIndex].data.push({
              x: dataIndex,
              y: dataObject[seriesKey],
            });
          }
        });
      } catch (error) {
        console.log("Error parsing JSON data:", error);
      }
    });

    chartDataRef.current = highResData;

    window.ApexCharts.exec("line-chart", "updateOptions", {
      chart: {
        animations: { enabled: false },
      },
      series: highResData,
    });
  };

  const handleClear = (): void => {
    serialData.current = [];
    chartDataRef.current = [];
    series.clear();

    window.ApexCharts.exec("line-chart", "updateOptions", {
      xaxis: {
        min: CHART_OPTIONS.xaxis.min,
        max: CHART_OPTIONS.xaxis.max,
      },
    });

    setStatistics([]);
  };

  const exportToCSV = (): void => {
    let csvData = "data:text/csv;charset=utf-8,sample,";

    // Print headers
    const entries = Array.from(series.entries()).sort(
      (e1, e2) => e1[1] - e2[1]
    );
    csvData += entries.map((entry) => entry[0]).join(",") + "\n";

    serialData.current.forEach((jsonValue, index) => {
      try {
        const dataObject = JSON.parse(jsonValue);
        const rowData: (string | number)[] = [index];
        entries.forEach(([seriesKey]) => {
          typeof dataObject === "undefined"
            ? rowData.push("")
            : rowData.push(dataObject[seriesKey]);
        });

        csvData += rowData.join(",") + "\n";
      } catch (error) {
        console.log("Error parsing JSON data:", error);
      }
    });

    const encodedUri = encodeURI(csvData);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "data.csv");

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
  };

  const calculateStatistics = (): void => {
    const entries = Array.from(series.entries()).sort(
      (e1, e2) => e1[1] - e2[1]
    );

    const dataStats: DataStats = chartData.map((seriesData, index) => {
      const numSamples = seriesData.data.length;
      const mean = seriesData.data.reduce<number>(
        (acc, { y }) => acc + y / numSamples,
        0
      );
      const stdev = Math.sqrt(
        seriesData.data.reduce<number>(
          (acc, { y }) => acc + Math.pow(y - mean, 2),
          0
        ) / numSamples
      );

      return {
        name: entries[index][0],
        mean,
        stdev,
      };
    });

    setStatistics(dataStats);
  };

  return (
    <Styles.Container>
      <Styles.Row>
        <Col>
          <h1>Arduino Serial Data Viewer</h1>
        </Col>
      </Styles.Row>
      <Styles.Row>
        <Col>
          <Styles.Card>
            <Card.Body>
              <Chart
                //options={CHART_OPTIONS}
                series={chartData}
                width={CHART_OPTIONS.chart.width}
                height={CHART_OPTIONS.chart.height}
              />
            </Card.Body>
          </Styles.Card>
        </Col>
        <Col>
          <Card style={{padding: "10px", height: "100%"}}>
            <Card.Body>
              <InputGroup style={{marginBottom: "24px", width: "100%"}}>
                <InputGroup.Text>
                  <span style={{fontWeight: "500",marginRight: "16px"}}>Status:</span>
                  <span style={{fontWeight: "500", float: "right", display: "inline-block", textTransform: "capitalize"}}>
                    {status}
                  </span>
                </InputGroup.Text>
                <InputGroup>
                  {status === "disconnected" ? (
                    <Button onClick={handleConnect}>Connect</Button>
                  ) : (
                    <Button onClick={handleDisconnect}>Disconnect</Button>
                  )}
                </InputGroup>
              </InputGroup>

              <Button
                onClick={handleClear}
                disabled={serialData.current.length === 0}
              >
                Clear Data
              </Button>
              <Button
                onClick={exportToCSV}
                disabled={serialData.current.length === 0}
              >
                Export to CSV
              </Button>
              <Button
                onClick={calculateStatistics}
                disabled={serialData.current.length === 0}
              >
                Statistics
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Styles.Row>

      {statistics.length > 0 && (
        <Styles.Row>
          <Col>
            <Card style={{marginTop: "30px"}}>
              <Card.Body>
                <h2>Statistics</h2>
                <Table striped>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Mean</th>
                      <th>Stdev</th>
                      <th>RSD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.map(({ name, mean, stdev }) => {
                      const rsd = (stdev / mean) * 100;
                      return (
                        <tr key={`row-${name}`}>
                          <td>{name}</td>
                          <td>{mean.toFixed(3)}</td>
                          <td>{stdev.toFixed(3)}</td>
                          <td>{rsd.toFixed(3)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Styles.Row>
      )}
    </Styles.Container>
  );
};

export default Index;
