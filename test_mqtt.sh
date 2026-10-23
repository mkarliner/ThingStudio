     cd /home/agent/ThingStudio
     read -rp 'WiFi SSID: ' SSID
     read -rsp 'WiFi password: ' WIFIPASS; echo
     read -rp 'MQTT broker host: ' BROKER
     read -rp 'MQTT user: ' MQTTUSER
     read -rsp 'MQTT password: ' MQTTPASS; echo

     python3 test-flows/network-packages-pass.py \
       --port /dev/ttyACM0 \
       --ssid "$SSID" --wifi-password "$WIFIPASS" \
       --broker "$BROKER" --broker-port 1883 \
       --broker-user "$MQTTUSER" --broker-password "$MQTTPASS" \
       --http-url http://192.168.10.167:8000/ \
       --mpy-cross /home/agent/work/micropython/mpy-cross/build/mpy-cross
