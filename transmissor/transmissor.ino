#include "SerialDataExporter.h"

#include <MQUnifiedsensor.h>

/* Definições da MQ135 */
#define RatioMQ135CleanAir 3.6 
#define placa "Arduino UNO"
#define Voltage_Resolution 5
#define pin A0
#define type "MQ-135"
#define ADC_Bit_Resolution 10
#define RatioMQ135CleanAir 3.6

#include <Wire.h> //INCLUSÃO DE BIBLIOTECA
#include <Adafruit_BMP085.h> //INCLUSÃO DE BIBLIOTECA
#include<Wire.h>
 
//Endereco I2C do MPU6050
const int MPU=0x68;  //pino aberto 0X68 , pino ligado em 3,3V 0x69

//Variaveis globais
int acelX,acelY,acelZ,temperatura,giroX,giroY,giroZ;
 
Adafruit_BMP085 bmp; //OBJETO DO TIPO Adafruit_BMP085 (I2C)

int bufferSizes[] = {255, 15, 15};
SerialDataExporter exporter = SerialDataExporter(Serial, bufferSizes);
/* Declarando bmp e MQ135 */
MQUnifiedsensor MQ135(placa, Voltage_Resolution, ADC_Bit_Resolution, pin, type);

void setup()
{
  Serial.begin(9600); /* Na velocidade 9600 no Monitor Serial */
  MQ135.setRegressionMethod(1); /* Inicia o MQ135 */
  MQ135.init(); 

  float calcR0 = 0; /* Formula de calibração do MQ135 */
    for(int i = 1; i<=10; i++)
    {
      MQ135.update(); 
      calcR0 += MQ135.calibrate(RatioMQ135CleanAir);
    }
  MQ135.setR0(calcR0/10);
   Serial.begin(9600); //INICIALIZA A SERIAL
  if (!bmp.begin()){ //SE O SENSOR NÃO FOR INICIALIZADO, FAZ
  Serial.println("Sensor BMP180 não foi identificado! Verifique as conexões."); //IMPRIME O TEXTO NO MONITOR SERIAL
  Serial.begin(9600);     //inicia a comunicação serial
  Wire.begin();                 //inicia I2C
  Wire.beginTransmission(MPU);  //Inicia transmissão para o endereço do MPU
  Wire.write(0x6B);             
  //Inicializa o MPU-6050
  Wire.write(0); 
  Wire.endTransmission(true);
  }
}

void loop(void)
{ 

  double CO = MQ135.readSensor(); MQ135.setA(605.18); MQ135.setB(-3.937);
  double Alcohol = MQ135.readSensor(); MQ135.setA(77.255); MQ135.setB(-3.18);
  double NH4 = MQ135.readSensor(); MQ135.setA(102.2 ); MQ135.setB(-2.473);
  double Acetona = MQ135.readSensor(); MQ135.setA(34.668); MQ135.setB(-3.369);
  double CO2 = MQ135.readSensor(); MQ135.setA(110.47); MQ135.setB(-2.862);

 
  MQ135.update(); /* Atualiza os dados do MQ135 */
  delay(2000);
  Wire.beginTransmission(MPU);      //transmite
  Wire.write(0x3B);                 // Endereço 0x3B (ACCEL_XOUT_H)
  Wire.endTransmission(false);     //Finaliza transmissão
  
  Wire.requestFrom(MPU,14,true);   //requisita bytes
   
  //Armazena o valor dos sensores nas variaveis correspondentes
  acelX=Wire.read()<<8|Wire.read();  //0x3B (ACCEL_XOUT_H) & 0x3C (ACCEL_XOUT_L)     
  acelY=Wire.read()<<8|Wire.read();  //0x3D (ACCEL_YOUT_H) & 0x3E (ACCEL_YOUT_L)
  acelZ=Wire.read()<<8|Wire.read();  //0x3F (ACCEL_ZOUT_H) & 0x40 (ACCEL_ZOUT_L)
  temperatura=Wire.read()<<8|Wire.read();  //0x41 (TEMP_OUT_H) & 0x42 (TEMP_OUT_L)
  giroX=Wire.read()<<8|Wire.read();  //0x43 (GYRO_XOUT_H) & 0x44 (GYRO_XOUT_L)
  giroY=Wire.read()<<8|Wire.read();  //0x45 (GYRO_YOUT_H) & 0x46 (GYRO_YOUT_L)
  giroZ=Wire.read()<<8|Wire.read();  //0x47 (GYRO_ZOUT_H) & 0x48 (GYRO_ZOUT_L)

  double pressao = bmp.readPressure();
 
  exporter.add("Temperatura", bmp.readTemperature());
  exporter.add("Altitude", bmp.readAltitude());
  exporter.add("Pressao", pressao);
  exporter.add("CO", CO);
  exporter.add("CO2", CO2);
  exporter.add("Alcohol", Alcohol);
  exporter.add("NH4", NH4);
  exporter.add("Acetona", Acetona);
  exporter.add("AcelX", acelX);
  exporter.add("AcelY", acelY);
  exporter.add("AcelZ", acelZ);
  exporter.add("GiroX", giroX);
  exporter.add("GiroY", giroY);
  exporter.add("GiroZ", giroZ);
  exporter.exportJSON();
  //Aguarda 500 ms
  delay(500);
}