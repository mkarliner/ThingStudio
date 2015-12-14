Template.DebugBody.events({
	'click .tab': function (e, tmpl) {
		var tabs = tmpl.findAll('.tab a')
		$(tabs).removeClass('active')
		var newTab = e.target
		$thisTab = $(newTab)
		$thisTab.addClass('active');
		thisTabBlockID = $thisTab.attr('href')
		$(".debug-page > div").css({"display": "none"})
		$(".debug-page " + thisTabBlockID).css({"display": "block"})
	}
})

Template.DebugBody.helpers({
	feeds: function() {
		return Feeds.find();
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
		}
		catch(err){
			return err + " " + this
		}
	}
})

Template.DebugSubscribe.helpers({
	messages: function(){
		return Messages.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
		}
		catch(err){
			return err + " " + this
		}
	}
});

Template.DebugPublish.helpers({
	outbox: function(){
		return Outbox.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
		}
		catch(err){
			return err + " " + this
		}
	}
});

Template.DebugRuntime.helpers({
	runTimeErrorLog: function () {
		return Session.get("runtimeErrors")
	}
})
