Template.currentStyle.helpers({
	currentStyle: function(){
		id = Session.get("currentTheme");
		theme = Themes.findOne({_id: id});
		if(!theme) {
			theme = Themes.findOne({});
		}
		if(theme) {
			return theme.css;
		} else {
			return "";
		}
	}
})