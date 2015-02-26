Template.currentStyle.helpers({
	currentStyle: function(){
		id = Session.get("currentTheme");
		console.log("TH: ", id);
		theme = Themes.findOne({_id: id});
		if(!theme) {
			theme = Themes.findOne({});
		}
		if(theme) {
			console.log("CSS: ", theme.css);
			return theme.css;
		} else {
			return "";
		}
	}
})