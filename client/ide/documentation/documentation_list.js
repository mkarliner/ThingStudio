Template.DocumentationBody.onRendered(function() {
	$('ul.tabs').tabs();
});


Template.DocumentationBody.helpers({
	doc: function(title) {
		d =  Docs.findOne({"attributes.title": title});
		if(!d) {
			console.log("DANGER! Cannot find index entry: ", title);
			return {attributes: {title: title+" MISSING PAGE!"}};
		} else {
			return d;
		}
	},
	log: function() {
		console.log(this)
	},
	excerpt: function(){
		console.log("DBE" , this)
		return this.attributes.summary;
	},
	publishedDate: function(date) {
		return moment(this.lastUpdated).format('MMMM D, YYYY, hh:mm:ss a' );
	},
	recentChanges: function(){
		return this.newChanges ? "RECENT CHANGES" : "";
	},
	changes: function(){
		changes = DocChanges.find({},{sort: {date: -1}});
		console.log("DocChanges ", changes.fetch())
		return changes;
	},
	docLink: function() {
		return Docs.findOne({filename: this.file}).attributes.urlstring
	},
	changedDate: function() {
		return moment(this.date).format('MMMM D, YYYY, hh:mm:ss a' );
	},
	addedremoved: function(){
		return this.diff.added ? "Addition" : "Removal";
	}
})
