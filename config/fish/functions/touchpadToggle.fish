function touchpadToggle
	if synclient -l | ag TouchpadOff | ag 0
synclient TouchpadOff=1
else
synclient TouchpadOff=0
end
end
