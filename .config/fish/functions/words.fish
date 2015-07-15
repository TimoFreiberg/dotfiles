function words
	tr ' ' '\n' | ag --nocolor '^\w'
end
