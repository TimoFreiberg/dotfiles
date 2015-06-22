#!/bin/sh

if [ -n $(lsusb | ag mouse) ]; then
  /usr/bin/synclient TouchpadOff=1
else
  /usr/bin/synclient TouchpadOff=0
fi
