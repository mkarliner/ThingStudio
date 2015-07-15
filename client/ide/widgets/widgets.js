Template.WidgetsBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.WidgetList.created = function(){
	//InstantiateWidgets();
}

Template.WidgetsHeader.events({
	'change input': function(e){
		console.log("WIN ", e.originalEvent.srcElement.files);
		file = e.originalEvent.srcElement.files[0];
		reader = new FileReader();
		reader.onload = function(thing) {
			console.log("TJING", thing);
			console.log("TSRC ", thing.srcElement.result)
			// return function(e) {thing.src = e.target.result};)(img)
		}
		reader.readAsText(file)
	}
})


Template.WidgetsBody.helpers({
	myWidgetList: function(){
		wl =  Widgets.find({  appId: {$ne: Meteor.settings.public.systemApp}, widgetType: "Web Component"})
		return wl;
	},
	systemWidgetList: function(){
		console.log("SWL System App Id", Meteor.settings.public.systemApp)
		wl =  Widgets.find({ appId: Meteor.settings.public.systemApp, widgetType: "Web Component"})
		return wl;
	},
	systemTemplateList: function(){
		console.log("SWL System App Id", Meteor.settings.public.systemApp)
		wl =  Widgets.find({ appId: Meteor.settings.public.systemApp, widgetType: "Library Template"})
		return wl;
	},
	myTemplatesList: function(){
		wl =  Widgets.find({  appId: {$ne: Meteor.settings.public.systemApp}, widgetType: "Library Template"});
		return wl;
	}
});

Template.WidgetList.helpers({
	widgetTag: function(){
		console.log("WT: ", this.tagName)
		paramString = " "
		if(this.parameters) {
			for(var p=0; p<this.parameters.length; p++) {
				paramString += " " + this.parameters[p].title + "=\"" + this.parameters[p].dummyValue + "\"";
			}
		}
		retstr =  "<"+this.tagName+ paramString + ">";

		return retstr;
	},
	screenInstance: function(){
		scr = Screens.findOne({_id: this.baseScreen});
		return scr.title;
		
	},
	dummyData: function(){
		dd = {}
		return {};
		if(this.parameters){
			for(var p=0; p < this.parameters.length; p++){
				dd[this.parameters[p].title] = this.parameters[p].dummyValue;
			}
		}
		return dd;
	},
	widgetEndTag: function(){
		return "</"+this.tagName+">";
	},
	owner: function() {
		return (this.owner == Meteor.userId())
	},
	isSystemWidget: function() {
		if ( this.appId == Meteor.settings.public.systemApp ) {
			return true;
		} else {
			return false;
		}
	},
	webComponent: function(){
		return this.widgetType=="Web Component" ? true : false;
	}
});

Template.WidgetsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		if ( $('.add-new-item').hasClass('open')) {
			$('.tab-my-widgets').trigger("click");
		}
	}
});

Template.WidgetsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

