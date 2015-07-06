Template.SingleWidgetBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.SingleWidgetBody.helpers({
	currentScreen: function() {
		scr =  Screens.findOne({_id: this.baseScreen})
		scn = scr;
		//console.log("HTML: ", scn);
		if(scn) {
			//console.log("HTML: ", scn.html);
			delete Template[scn.title];
			compileTemplate(scn.title, scn.html, scn.js);
			return scn.title;
		} else {
			return "NoScreen";
		}
	},
	html: function() {
		return Screens.findOne({_id: this.baseScreen}).html;
	},
	js: function() {
		return Screens.findOne({_id: this.baseScreen}).js;
	},
	mandatory: function() {
		// return Widgets.findOne({_id: this.})
		if (this.required)
			return 'icon-ts-checkmark'
	},
	dummyData: function(){
		dd = {}
		if(this.parameters){
			for(var p=0; p < this.parameters.length; p++){
				dd[this.parameters[p].title] = this.parameters[p].dummyValue;
			}
		}
		return dd;
	}
});